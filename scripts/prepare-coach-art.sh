#!/usr/bin/env bash
set -euo pipefail

input_path=${1:?input image is required}
full_output_path=${2:?full-body output image is required}
bust_output_path=${3:?bust output image is required}

# Keep the submitted drawing intact: only orient it, remove the connected
# near-white paper background, trim the canvas, and add transparent padding.
temporary_path="${full_output_path%.png}.working.png"

convert "$input_path" \
  -rotate -90 \
  -alpha on \
  -bordercolor white -border 2 \
  -fuzz 8% -fill none -draw 'matte 0,0 floodfill' \
  -shave 2x2 \
  -trim +repage \
  -bordercolor none -border 48 \
  "$temporary_path"

# The faint handwritten note sits to the right of the figure after rotation.
# Crop it away without changing any character pixels.
convert "$temporary_path" -gravity west -crop 560x+0+0 +repage "$full_output_path"

# The in-app coach slots are compact. Keep an exact upper-body crop for them,
# while retaining the complete submitted character as the full-body asset.
convert "$full_output_path" -gravity north -crop 560x1120+0+0 +repage "$bust_output_path"

rm -f "$temporary_path"
