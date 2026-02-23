from influxdb_client import InfluxDBClient
import pandas as pd

class DataFetcher:
    def __init__(self, url, token, org):
        self.client = InfluxDBClient(url=url, token=token, org=org, timeout=30000)
        self.query_api = self.client.query_api()

    # --- Discovery (Sin cambios) ---
    def get_clients(self, bucket):
        q = f'import "influxdata/influxdb/schema"\n schema.tagValues(bucket: "{bucket}", tag: "client")'
        try: return [r.get_value() for t in self.query_api.query(q) for r in t.records]
        except: return []
    def get_sites(self, bucket, client):
        q = f'''from(bucket: "{bucket}") |> range(start: -30d) |> filter(fn: (r) => r.client == "{client}") |> keep(columns: ["site_name"]) |> distinct(column: "site_name")'''
        try: return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except: return []
    def get_serials(self, bucket, client, site):
        q = f'''from(bucket: "{bucket}") |> range(start: -30d) |> filter(fn: (r) => r.client == "{client}") |> filter(fn: (r) => r.site_name == "{site}") |> keep(columns: ["SerialNumber"]) |> distinct(column: "SerialNumber")'''
        try: return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except: return []
    def get_devices(self, bucket, client, site, serial=None):
        filter_serial = f'|> filter(fn: (r) => r.SerialNumber == "{serial}")' if serial and serial != "-- TODOS --" else ''
        q = f'''from(bucket: "{bucket}") |> range(start: -7d) |> filter(fn: (r) => r.client == "{client}") |> filter(fn: (r) => r.site_name == "{site}") {filter_serial} |> keep(columns: ["device"]) |> distinct(column: "device")'''
        try: return sorted([r.get_value() for t in self.query_api.query(q) for r in t.records if r.get_value()])
        except: return []

    # --- QUERIES CORREGIDAS (Respetan el rango del usuario) ---
    def get_data_daily(self, bucket, device_name, range_val, client=None, site=None, serial=None):
        # Logica inteligente de rango
        range_line = ""
        if "start:" in str(range_val): # Si viene formato FLUX completo (start: x, stop: y)
            range_line = f"|> range({range_val})"
        elif 'd' in str(range_val):    # Si viene formato corto "7d", "30d"
            try: range_line = f"|> range(start: -{range_val})"
            except: range_line = f"|> range(start: -7d)" # Fallback
        else:
            range_line = f"|> range(start: -7d)" # Fallback final

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
         # Misma logica de rango
         range_line = ""
         if "start:" in str(range_val): range_line = f"|> range({range_val})"
         elif 'd' in str(range_val):    range_line = f"|> range(start: -{range_val})"
         else: range_line = f"|> range(start: -7d)"

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
