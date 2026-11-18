# V2 design assets

Downloaded from the read-only Figma design context for PackIt:
https://www.figma.com/design/ETZmBxBvSsDaaDJ5uUmKyR/Packit?node-id=269-2125

The grey **Example Responsive** board (desktop `257:1491`, tablet `277:3437`) and **GO** area supply the V2 references. The original SVG files are kept intact. `components/editor-v2/assets.ts` maps the design-context asset names to local files; no expiring Figma asset URLs are used at runtime.

The GO follow-up uses `600:7945` and `553:4531` for decoration, `430:4386`, `558:9427` and `558:9863` for layer properties, and `591:5264` for the color picker. Layer icons are in `layers/`; the credit coin and ribbon are in `go/`. The color picker was also inspected read-only in Safari after the design-context quota was reached.

The dieline and 3D preview use the app's live renderers, not the mockup's placeholder images. Rectangles, lines, and user-added artwork are editable native elements.
