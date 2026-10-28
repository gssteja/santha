#!/usr/bin/env python3
"""Builds android/src/main/assets/counties.tsv for the weather-alert decoder: SAME location codes are county FIPS
codes. Source (public domain): the Census Bureau's county Gazetteer, e.g.
https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip

Usage: make_counties.py <gazetteer zip> <out file>
Output: one line per county, "SSCCC<TAB>ST<TAB>Name<TAB>lat<TAB>lon" (internal point, for "which county am I in").
"""
import csv
import io
import sys
import zipfile

z = zipfile.ZipFile(sys.argv[1])
text = z.read(z.namelist()[0]).decode("utf-8")
rows = csv.DictReader(io.StringIO(text), delimiter="|")
with open(sys.argv[2], "w", encoding="utf-8") as out:
    for r in rows:
        r = {k.strip(): v.strip() for k, v in r.items()}
        out.write(f"{r['GEOID']}\t{r['USPS']}\t{r['NAME']}\t{float(r['INTPTLAT']):.4f}\t{float(r['INTPTLONG']):.4f}\n")
