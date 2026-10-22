# Vantage Master V2 (한글판, Vmtv2.exe 1998) 데이터 포맷 노트

리버스 엔지니어링 결과. 툴은 `tools/vm2/` (`python3 tools/vm2/vm2.py`). 게임 에셋은 리포에 넣지 않는다.

## 아카이브 `DATAxx.DAT` — "LB DAT"
```
0x00  "LB DAT\x1a\0"
0x08  u32 count            (DATA00=100, 08/09/13=200, 10=320)
0x0C  u32 0
0x10  u32 offsets[count+1] 사용하지 않는 슬롯은 0. 마지막 엔트리 다음 슬롯 = 끝 오프셋(파일 길이).
```
리소스 ID = `(file << 16) | entry` (예: `0x000A006A` = DATA10 #106). 로더: `0x420E70`, 읽기 버퍼 768KB(`0x47F1EC`) → 압축 엔트리는 786432B 이하여야 함.

## 엔트리 압축 (`0x4484E0`)
청크 연속: `u16 size`(헤더 포함) + 데이터, 청크 뒤 1바이트가 0이 아니면 다음 청크.
- 데이터 첫 바이트 == 0 → **비트 플래그 LZ** (FALCOM2류): 플래그 u16(첫 청크는 u8), 0=리터럴, 1→(0: 8비트 오프셋 / 1: 13비트 오프셋; 오프셋 0=종료, 1=RLE), 길이 2/3/4/5/(byte+14)/(3bit+6).
- 첫 바이트 != 0 → **바이트 코드 LZ/RLE**: `1ooo oooo`+byte = 복사(len=((c>>5)&3)+4, 13비트 오프셋, 이어서 `011n nnnn` 연장), `0100 nnnn`(+byte 값) RLE len+4, `0101 nnnn`+byte+val RLE 12비트, `001n nnnn`+byte 리터럴 13비트, `000n nnnn` 리터럴 5비트.
- 리팩은 리터럴 전용 인코딩(`compress_store`)으로 충분(디코더가 그대로 읽음). 큰 이미지는 768KB 한계 주의.

## DATA10 — 맵/텍스트 (cp949)
| 엔트리 | 내용 |
|---|---|
| 0–51 | 맵 헤더(716B+): `name[16]`, +16 u32 ids×8 (…, [2] 타일셋 이미지, [3] 팔레트, [4] 타일 정의, [5] 타일맵, [6] BGM(DATA11, 미포함)), +48 u32×18 파라미터, +120 설명문, 이후 두 번째 설명(`《…》`) |
| 52–89 | 마스터 38명: `name[20]`, +20 클래스 id, +28 설명, 끝 12B 수치 |
| 90–171 | 타일셋 10벌: 아틀라스 이미지(8bpp, 24×12 청크 연속), 팔레트(43색, BGRA), 타일 정의 512×100B, 타일맵 32×32 u16 (맵 수만큼) |
| 172–275 | 맵당 2개: 205000B = 네이티얼 25종 × 32×32 i32 이동비용(-5000=불가) ×2 + 끝 25+25 u32 (로더 `0x448460`), 44720B = 미해독 |

**타일맵**: 32행 × 32열 u16 타일 id. 홀수 행은 반 칸 오른쪽(`col = (x - (row&1)) / 2` 좌표계, `0x412C7B` 참고).
**타일 정의**(100B): 좌/우 24px 컬럼 각각 24개 슬랩 id(u16, 0x7FF=없음, 아틀라스 24×12 청크) + `[96]` 기준 높이, `[97]` 높이(LOS용), `[98]` 지형 타입, `[99]` 플래그.
**렌더 규칙**(검증됨): 헥스 폭 48 = 좌 컬럼(list0) + 우 컬럼(list1). 슬랩 k는 **아래→위**로 쌓임(화면 y = base − (k+1)·12). 행 간격 18px, 홀수 행은 +24px. 높이 h 타일은 슬랩 h+3개(절벽 h + 상판 3). 그리기 순서는 위 행부터.
팔레트: 픽셀값 v → 타일셋 팔레트[v−17] (16 = 투명). 전역 팔레트 합성 로직은 미해독이라 일부 색은 다를 수 있음.

## 모딩 워크플로
```
python3 tools/vm2/vm2.py editor <게임폴더> editor.html   # 브라우저에서 열기: 맵 선택 → 타일 칠하기 → 저장 슬롯 선택 → JSON 내보내기
python3 tools/vm2/vm2.py map-import mapNN.json mod/     # (저장 슬롯이 다르면 그 슬롯에 복제 + 헤더의 타일맵 id 재지정)
python3 tools/vm2/vm2.py pack <게임폴더> mod/ built/      # built/DATA10.DAT 를 게임 폴더에 덮어쓰기 (원본 백업!)
```
**지형 타입**(EXE `0x45A058` 이름표 / `0x45A0B8` 명중률): 0 평지, 1 사막, 2 수풀(80), 3 습지, 4 적설, 5 썩은늪, 6 수면판, 7–9 물 깊이1–3(90/80/75), 10 장애물, 11 허공, 12–15 마법석(70), 16 벽.

## 그 외
- DATA13: WAV 154개. DATA08: 배경/UI 이미지(8bpp, 768×400 아틀라스 등)+팔레트(68색). DATA00/09: 스프라이트 시트(8bpp, 프레임 테이블 미해독), 24×24 타일 배치표(1152B), 소형 팔레트.
- 8bpp 이미지는 전역 256색 팔레트에 소형 팔레트를 조립해 쓰므로 정확한 색은 팔레트 배정 로직(미해독)이 필요. 타일셋은 `v-17` → 팔레트 인덱스가 대략 맞는다.
- 네이티얼 24종의 스탯 테이블은 아직 못 찾음(EXE .data 또는 DATA00 추정).

## Findings from the English build (Vantage Master Online, vmv2.exe 2000-01)

- `DATA00/09/10.DIR` — "LB DIR" tables: 36-byte records `name[12] (8.3 with `._XX` ext), u32 ?, u32 packed size, u32 unpacked size (rounded), u32 time, u32 offset`.
  Extensions: `_SC` script/header, `_BG` tile atlas, `_PL` palette, `_MP` tiledefs, `_MD` tilemap, `_VM`/`_MV` per-map derived tables,
  `_CH` character chunk atlas, `_CP` character placement table, `_BM` bitmap, `_FN` font.
- Global 256-colour palette (vmv2.exe `0x422c32`, SetPaletteEntries(10, 236)): `10-15` SYSPAL[0..5], `16` transparent,
  `17-59` map palette (BG####P, 43 colours, R,G,B,flag), `60-99` CHRPAL[0..39], `100-127` SYSPAL[12..39], `240-245` SYSPAL[6..11].
  SYSPAL/CHRPAL are DATA00 entries 1 and 2 (40 colours each). Night mode darkens entries 118-230 ((v-20)/3).
- Unit sprites (`DATA02`, image/placement pairs): image = 24x12 chunk atlas (288 bytes per chunk, values 16=transparent);
  placement = 96-byte records of 48 u16 chunk ids (0x7ff = empty). **Two consecutive records form one 6x8 chunk grid**
  (slot s -> column s>>3, row 7-(s&7), i.e. bottom-up), which is three 48x96 frames side by side. 1152-byte tables = 6 pairs = 18 frames.
  Entries 0..70: 18 masters x (blue, red). Natials (blue entry; red = +2): see `NATIAL_SPRITE` in `packages/vm2web/src/vm2data.ts`.
  DATA03 holds the same characters inside summoning circles plus spell effects.
- Natial portraits (`DATA09` SP400..SP630 + `_P` 63-colour palettes): raw 8-bit, dimensions come from the natial script
  ED400+k: the record `(entry, 9, 512, 512, x0)` is followed by `(y0, x1, y1, …)`; width = x1-x0, height = y1-y0.
- Sound: `DATA13` = RIFF/WAVE effects (22 kHz 16-bit mono). BGM = `MIDI/CR0xxGM.MID` (General MIDI).
- English natial table lives at VA `0x474A30` (same 0x58-byte layout); `vm2web` now finds the table by scanning for 24
  records whose +0x50/+0x54 point at short strings, so either build works.
