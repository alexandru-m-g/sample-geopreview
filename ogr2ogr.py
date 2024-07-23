from json import JSONDecodeError, loads
from pathlib import Path
from shutil import rmtree
from subprocess import run
from zipfile import ZipFile

cwd = Path(__file__).parent
inputs = cwd / "inputs"
outputs = cwd / "outputs"


def ogrinfo(file: Path):
    return run(["ogrinfo", "-json", file], capture_output=True).stdout.decode("utf-8")


def ogr2ogr(layers: list, dest: Path, src: Path):
    name = dest.name.replace(".", "_")
    for layer in layers:
        if layer["featureCount"] > 0:
            (outputs / name).mkdir(parents=True, exist_ok=True)
            run(
                [
                    "ogr2ogr",
                    "-overwrite",
                    "-makevalid",
                    *["-dim", "XY"],
                    *["-t_srs", "EPSG:4326"],
                    *["-nlt", "PROMOTE_TO_MULTI"],
                    *["-nln", layer["name"]],
                    outputs / name / f"{layer["name"]}.gpkg",
                    *[src, layer["name"]],
                ]
            )


def unzip(file: Path, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    with ZipFile(file, "r") as zip:
        for zip_info in zip.infolist():
            if zip_info.is_dir():
                continue
            zip_info.filename = Path(zip_info.filename).name
            zip.extract(zip_info, dest)


if __name__ == "__main__":
    for file in inputs.iterdir():
        info = ogrinfo(file)
        try:
            # to open the file
            layers = loads(info)["layers"]
            ogr2ogr(layers, file, file)
        except JSONDecodeError:
            if file.suffix == ".zip":
                dest = inputs / f"{file.stem}_zip"
                unzip(file, dest)
                info = ogrinfo(dest)
                try:
                    # to open the directory
                    layers = loads(info)["layers"]
                    ogr2ogr(layers, file, dest)
                except JSONDecodeError:
                    for f in dest.iterdir():
                        info = ogrinfo(f)
                        try:
                            # to open a file in the directory
                            layers = loads(info)["layers"]
                            ogr2ogr(layers, file, f)
                        except JSONDecodeError:
                            pass
                rmtree(dest, ignore_errors=True)
