# Usamos una imagen base ligera de Python
FROM python:3.11-slim

# Instalamos dependencias del sistema necesarias para WeasyPrint (PDFs)
# Pango, cairo, etc. son librerías gráficas requeridas por WeasyPrint en Linux
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    python3-pip \
    python3-setuptools \
    python3-wheel \
    python3-cffi \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Establecemos directorio de trabajo
WORKDIR /app

# Copiamos y instalamos requerimientos
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el resto del código
COPY . .

# Directorios para persistencia (Salida de reportes y Perfiles de configuración)
RUN mkdir -p /app/output /app/profiles

# Comando por defecto (Mantiene el contenedor vivo o ejecuta el script)
# Usaremos "tail -f /dev/null" para mantenerlo vivo y poder entrar a ejecutar comandos manuales,
# o bien se puede configurar para ejecutar el script directamente.
# Para este caso de uso "Agente a demanda", dejarlo vivo es útil, o exponer una API.
# Por ahora, permitimos ejecutarlo manualmente.
CMD ["python", "main.py"]
