#!/bin/bash
cd "$(dirname "$0")"
python3 -m http.server 8080 &
open http://127.0.0.1:8080
wait
