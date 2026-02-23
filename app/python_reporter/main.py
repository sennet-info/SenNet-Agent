import os
import sys
import json
import argparse
from datetime import datetime

# Asegurar que podemos importar los módulos
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from modules.db_connector import DataFetcher
# from modules.analyzer import Analyzer
# from modules.visualizer import Visualizer
# from modules.pdf_generator import PDFComposer

def load_profile(profile_name):
    profile_path = os.path.join("profiles", profile_name)
    if not os.path.exists(profile_path):
        # Intentar añadir .json si no está
        profile_path += ".json"
    
    if not os.path.exists(profile_path):
        raise FileNotFoundError(f"No se encontró el perfil: {profile_path}")
        
    with open(profile_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def main():
    parser = argparse.ArgumentParser(description="SenNet Report Agent - Generador de Informes")
    parser.add_argument("--profile", required=True, help="Nombre del archivo JSON en la carpeta profiles/")
    parser.add_argument("--device", help="Serial del dispositivo (opcional, si no se define, procesa todos los del perfil)")
    parser.add_argument("--days", type=int, default=30, help="Días atrás a analizar (default: 30)")
    
    args = parser.parse_args()

    print(f"🚀 SenNet Report Agent Iniciado...")
    print(f"📂 Cargando perfil: {args.profile}")
    
    try:
        config = load_profile(args.profile)
        influx_cfg = config['influx_config']
        
        # Sobreescribir con variables de entorno si existen (útil para Docker)
        if os.getenv('INFLUX_TOKEN'): influx_cfg['token'] = os.getenv('INFLUX_TOKEN')
        if os.getenv('INFLUX_ORG'): influx_cfg['org'] = os.getenv('INFLUX_ORG')
        
        print(f"🏢 Cliente: {config.get('profile_name', 'Desconocido')}")
        print(f"📡 Conectando a InfluxDB: {influx_cfg['url']} (Bucket: {influx_cfg['bucket']})")
        
        fetcher = DataFetcher(url=influx_cfg['url'], token=influx_cfg['token'], org=influx_cfg['org'])
        
        devices_to_process = config['devices']
        if args.device:
            devices_to_process = [d for d in devices_to_process if d['serial'] == args.device]
            
        if not devices_to_process:
            print("❌ No se encontraron dispositivos para procesar.")
            return

        for dev in devices_to_process:
            serial = dev['serial']
            alias = dev.get('alias', serial)
            print(f"\n🔹 Procesando dispositivo: {alias} ({serial})")
            
            # Obtener datos (Ahora pasamos lista de devices si existe)
            range_str = f"{args.days}d"
            sub_devices = dev.get('filter_device') # Lista ["General", "Horno..."] o None
            
            try:
                df = fetcher.get_data(
                    bucket=influx_cfg['bucket'], 
                    serial=serial, 
                    range_val=range_str,
                    device_filter=sub_devices
                )
                if df.empty:
                    print(f"⚠️ No hay datos para {serial} en los últimos {args.days} días.")
                    continue
                
                print(f"✅ Datos obtenidos: {len(df)} registros.")
                
                # AQUI IRÁ LA LÓGICA DE ANÁLISIS Y GENERACIÓN
                # ...
                
            except Exception as e:
                print(f"❌ Error procesando {serial}: {e}")

        print("\n✅ Proceso finalizado.")

    except Exception as e:
        print(f"🔥 Error crítico: {e}")

if __name__ == "__main__":
    main()
