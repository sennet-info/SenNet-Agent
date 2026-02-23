from influxdb_client import InfluxDBClient
import pandas as pd

class DataFetcher:
    def __init__(self, url, token, org):
        self.client = InfluxDBClient(url=url, token=token, org=org)
        self.query_api = self.client.query_api()

    def get_data(self, bucket, serial, range_val, device_filter=None):
        # Filtro base por SerialNumber
        flux_filter = f'|> filter(fn: (r) => r["SerialNumber"] == "{serial}")'
        
        # Filtro opcional por tag "device" (Si hay sub-dispositivos definidos)
        if device_filter and len(device_filter) > 0:
            # Construir regex: (General|Horno|etc)
            regex = "|".join(device_filter)
            flux_filter += f'\n  |> filter(fn: (r) => r["device"] =~ /^{regex}$/)'
            
        query = f'''
        from(bucket: "{bucket}")
          |> range(start: -{range_val})
          {flux_filter}
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        '''
        df = self.query_api.query_data_frame(query)
        return df

```
