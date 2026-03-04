from influxdb_client import InfluxDBClient
import pandas as pd
from threading import Lock


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
        range_line = ""
        if "start:" in str(range_val):
            range_line = f"|> range({range_val})"
        elif 'd' in str(range_val):
            try:
                range_line = f"|> range(start: -{range_val})"
            except Exception:
                range_line = "|> range(start: -7d)"
        else:
            range_line = "|> range(start: -7d)"

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
        return self.query_api.query_data_frame(query)

    def get_data_raw(self, bucket, device_name, range_val, client=None, site=None, serial=None):
        range_line = ""
        if "start:" in str(range_val):
            range_line = f"|> range({range_val})"
        elif 'd' in str(range_val):
            range_line = f"|> range(start: -{range_val})"
        else:
            range_line = "|> range(start: -7d)"

        filter_c = f'|> filter(fn: (r) => r["client"] == "{client}")' if client else ''
        filter_s = f'|> filter(fn: (r) => r["site_name"] == "{site}")' if site else ''
        filter_ser = f'|> filter(fn: (r) => r["SerialNumber"] == "{serial}")' if serial and serial != "-- TODOS --" else ''

        query = f'''
         from(bucket: "{bucket}") {range_line}
         |> filter(fn: (r) => r["device"] == "{device_name}")
         {filter_c} {filter_s} {filter_ser}
         |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
         '''
        return self.query_api.query_data_frame(query)
