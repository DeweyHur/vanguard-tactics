# vm2web — Vantage Master V2 workbench (browser)

Map viewer/editor, natial stat editor and master list for 밴티지 마스터 V2, running entirely in the browser.
Ships **no game assets**: you drop your own `DATA00.DAT … DATA13.DAT` + `Vmtv2.exe` in; they stay in IndexedDB on your machine.

- 맵 탭: hex-prism tile rendering, paint/eyedropper, name/description editing (within the original byte budget), copy a map into another slot.
- 네이티얼 탭: 24 natials, every numeric field editable.
- `DATA10.DAT 다운로드` / `Vmtv2.exe 다운로드`: modified files to drop into a copy of the game folder.

```
npm run dev      # http://localhost:5174
npm run build    # dist/  (deploy root = packages/vm2web)
npm test
```
Format notes: `docs/vm2-formats.md`. Python reference tools: `tools/vm2/`.
