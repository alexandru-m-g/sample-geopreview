FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  gdal-bin python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /usr/src/app

COPY ogr2ogr.py ./
COPY inputs/.gitignore ./inputs/
COPY outputs/.gitignore ./outputs/

CMD ["python", "ogr2ogr.py"]
