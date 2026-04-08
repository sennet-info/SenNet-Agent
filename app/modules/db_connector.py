from influxdb_client import InfluxDBClient
import pandas as pd
from threading import Lock
from typing import Any, Callable, Optional


class DataFetcher:
    _CLIENT_CACHE = {}
    _CACHE_LOCK = Lock()

    def __init__(self, url, token, org):
        cache_key = (url, token, org)
        with self._CACHE_LOCK:
            client = self._CLIENT_CACHE.get(cache_key)
            if client is None:
                client = InfluxDBClient(url=url, token=token, org=org, timeout=30000)
                self._CLIENT_CACHE[cache_key] = client
        self.client = client
        self.query_api = self.client.query_api()
        self._debug_query_recorder: Optional[Callable[[str, dict[str, Any]], None]] = None

    def set_debug_query_recorder(self, recorder: Optional[Callable[[str, dict[str, Any]], None]]):
        self._debug_query_recorder = recorder

    def _record_query(self, query: str, metadata: dict[str, Any]):
        if self._debug_query_recorder:
            self._debug_query_recorder(query, metadata)

    @staticmethod
    def _range_line(range_val):
        if "start:" in str(range_val):
            return f"|> range({range_val})"
        if "d" in str(range_val):
            return f"|> range(start: -{range_val})"
        return "|> range(start: -7d)"

    # --- Discovery (Sin cambios) ---
    def get_clients(self, bucket):
        q = f'import "influxdata/influxdb/schema"\n schema.tagValues(bucket: "{bucket}", tag: "client")'
        try:
            return [r.get_value() for t in self.query_api.query(q) for r in t.records]
        except Exception:
            return []

    def get_sites(self, bucket, client):
        q = f'''from(bucket: "{bucket}") |> range(start: -30d) |> filter(fn: (r) => r.client == "{client}") |> keep(columns: ["site_name"]) |> distinct(column: "site_name")'''
        try:
            return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except Exception:
            return []

    def get_serials(self, bucket, client, site):
        q = f'''from(bucket: "{bucket}") |> range(start: -30d) |> filter(fn: (r) => r.client == "{client}") |> filter(fn: (r) => r.site_name == "{site}") |> keep(columns: ["SerialNumber"]) |> distinct(column: "SerialNumber")'''
        try:
            return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except Exception:
            return []

    def get_devices(self, bucket, client, site, serial=None):
        filter_serial = f'|> filter(fn: (r) => r.SerialNumber == "{serial}")' if serial and serial != "-- TODOS --" else ''
        q = f'''from(bucket: "{bucket}") |> range(start: -7d) |> filter(fn: (r) => r.client == "{client}") |> filter(fn: (r) => r.site_name == "{site}") {filter_serial} |> keep(columns: ["device"]) |> distinct(column: "device")'''
        try:
            return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except Exception:
            return []

    # --- QUERIES CORREGIDAS (Respetan el rango del usuario) ---
    def get_data_daily(self, bucket, device_name, range_val, client=None, site=None, serial=None):
        range_line = self._range_line(range_val)

        filter_c = f'|> filter(fn: (r) => r["client"] == "{client}")' if client else ''
        filter_s = f'|> filter(fn: (r) => r["site_name"] == "{site}")' if site else ''
        filter_ser = f'|> filter(fn: (r) => r["SerialNumber"] == "{serial}")' if serial and serial != "-- TODOS --" else ''

        query = f'''
        from(bucket: "{bucket}") {range_line}
        |> filter(fn: (r) => r["device"] == "{device_name}")
        {filter_c} {filter_s} {filter_ser}
        |> filter(fn: (r) => r["_field"] =~ /ENEact|EP_imp|active_energy|AI|AE/)
        |> aggregateWindow(every: 1d, fn: spread, createEmpty: false)
        |> timeShift(duration: 1h)
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        '''
        self._record_query(query, {"type": "daily", "device": device_name})
        return self.query_api.query_data_frame(query)

    def get_data_raw(self, bucket, device_name, range_val, client=None, site=None, serial=None):
        range_line = self._range_line(range_val)

        filter_c = f'|> filter(fn: (r) => r["client"] == "{client}")' if client else ''
        filter_s = f'|> filter(fn: (r) => r["site_name"] == "{site}")' if site else ''
        filter_ser = f'|> filter(fn: (r) => r["SerialNumber"] == "{serial}")' if serial and serial != "-- TODOS --" else ''

        query = f'''
         from(bucket: "{bucket}") {range_line}
         |> filter(fn: (r) => r["device"] == "{device_name}")
         {filter_c} {filter_s} {filter_ser}
         |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
         '''
        self._record_query(query, {"type": "raw", "device": device_name})
        return self.query_api.query_data_frame(query)

    def get_device_energy_status(
        self,
        bucket,
        client,
        site,
        serial=None,
        lookback_minutes=180,
        devices=None,
        battery_fields=None,
    ):
        filter_ser = f'|> filter(fn: (r) => r["SerialNumber"] == "{serial}")' if serial and serial != "-- TODOS --" else ""
        device_filter = ""
        if devices:
            device_checks = " or ".join([f'r["device"] == "{d}"' for d in devices if d])
            if device_checks:
                device_filter = f"|> filter(fn: (r) => {device_checks})"

        battery_field_checks = battery_fields or ["battery_voltage", "battery_v", "vbat", "vbatt", "bat_v", "battery"]
        battery_field_filter = " or ".join([f'r._field == "{f}"' for f in battery_field_checks if f])
        if not battery_field_filter:
            battery_field_filter = 'r._field == "battery_voltage"'

        battery_query = f'''
        from(bucket: "{bucket}") |> range(start: -{max(1, int(lookback_minutes))}m)
        |> filter(fn: (r) => r["client"] == "{client}")
        |> filter(fn: (r) => r["site_name"] == "{site}")
        {filter_ser}
        {device_filter}
        |> filter(fn: (r) => {battery_field_filter})
        |> keep(columns: ["_time", "_field", "_value", "device", "SerialNumber"])
        |> group(columns: ["device", "SerialNumber", "_field"])
        |> last()
        '''

        staleness_lookback = max(lookback_minutes * 8, 60)
        staleness_query = f'''
        from(bucket: "{bucket}") |> range(start: -{int(staleness_lookback)}m)
        |> filter(fn: (r) => r["client"] == "{client}")
        |> filter(fn: (r) => r["site_name"] == "{site}")
        {filter_ser}
        {device_filter}
        |> keep(columns: ["_time", "device", "SerialNumber"])
        |> group(columns: ["device", "SerialNumber"])
        |> last()
        '''

        battery_rows = []
        heartbeat_rows = []
        try:
            for table in self.query_api.query(battery_query):
                for rec in table.records:
                    battery_rows.append(
                        {
                            "deviceId": rec.values.get("device"),
                            "serial": rec.values.get("SerialNumber"),
                            "field": rec.get_field(),
                            "voltage": rec.get_value(),
                            "batteryAt": rec.get_time().isoformat() if rec.get_time() else None,
                        }
                    )
        except Exception:
            battery_rows = []

        try:
            for table in self.query_api.query(staleness_query):
                for rec in table.records:
                    heartbeat_rows.append(
                        {
                            "deviceId": rec.values.get("device"),
                            "serial": rec.values.get("SerialNumber"),
                            "lastSeenAt": rec.get_time().isoformat() if rec.get_time() else None,
                        }
                    )
        except Exception:
            heartbeat_rows = []

        return {"battery_rows": battery_rows, "heartbeat_rows": heartbeat_rows}
