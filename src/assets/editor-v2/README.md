# V2 design assets

Downloaded from the read-only Figma design context for PackIt:
https://www.figma.com/design/ETZmBxBvSsDaaDJ5uUmKyR/Packit?node-id=269-2125

Only the grey **Example Responsive** board is implemented (desktop `257:1491`, tablet `277:3437`). The original SVG files are kept intact. `components/editor-v2/assets.ts` maps the design-context asset names to local files; no expiring Figma asset URLs are used at runtime.

The dieline and 3D preview use the app's live renderers, not the mockup's placeholder images. Rectangles, lines, and user-added artwork are editable native elements.
