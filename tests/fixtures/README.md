`example.heic` is the HEIC example from the libheif project:
https://github.com/strukturag/libheif/blob/master/examples/example.heic

`transparency.tiff` is a generated 320 × 240 RGBA gradient with half-transparent pixels, encoded using UTIF. It contains no user image data.

The fixtures are used by the browser worker tests at `/tests/runner.html` while the development server is running. They are not included in the production build.
