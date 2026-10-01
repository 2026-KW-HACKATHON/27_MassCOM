# MassCOM mascot v2 sources

All assets were generated with OpenAI built-in `image_gen` using the three supplied references:

- `docs/assets/readme/hero.png` — character, palette, and neighborhood style reference
- `apps/mobile/assets/images/collectibles/showcase-a.png` — character proportions and watercolor rendering reference
- `apps/mobile/assets/images/mascot/mascot-stamp.png` — face, colors, leaf sprout, and stamp-pose reference

Shared mascot prompt used for `wave.png` through `logo-badge.png`:

> MassCOM Android app mascot asset with strict character-sheet consistency. Match the supplied references: the same round chubby penguin, deep royal-blue body and flippers, large white face and belly, one small green leaf sprout centered on top, small yellow-orange beak, yellow feet, pink blush cheeks, big glossy black eyes, and the same proportions and colors. Soft watercolor with clean anime linework, bright daylight palette, and gentle paper texture. No words, watermark, logo, extra limbs, or unrelated objects.

| File | Prompt | Tool |
| --- | --- | --- |
| `wave.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; cheerfully waving one flipper hello, signature wink, joyful open smile; both feet visible; no backdrop, floor, or shadow box. | OpenAI built-in `image_gen` |
| `explore-map.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; holding an open folded neighborhood map with both flippers, curious happy face, both eyes open; map contains simple street/park shapes but no text, labels, pins, or symbols. | OpenAI built-in `image_gen` |
| `stamp.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; dynamically raising a plain wooden rubber stamp, energetic forward motion, signature wink; no text or marks on stamp. | OpenAI built-in `image_gen` |
| `gift.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; hugging one ribboned gift box, excited wide-eyed expression; no writing or logo. | OpenAI built-in `image_gen` |
| `sleep.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; dozing peacefully against one round cushion, eyes closed, calm smile; only small lowercase z sleep marks allowed. | OpenAI built-in `image_gen` |
| `puzzled.png` | Shared mascot prompt. 1024×1024 transparent PNG; full body centered with about 6% padding; scratching head with one flipper, head tilted, friendly puzzled expression; one floating question-mark symbol only. | OpenAI built-in `image_gen` |
| `friends.png` | Shared mascot prompt. 1024×1024 transparent PNG; two full-body identical penguins high-fiving, both happy; second penguin distinguished only by a small orange scarf; centered group with about 6% padding. | OpenAI built-in `image_gen` |
| `search.png` | Shared mascot prompt. 1024×1024 transparent PNG; full-body mascot peering through a handheld magnifying glass, one eye visibly enlarged through the clear lens, curious delighted expression, natural grip, both feet visible. | OpenAI built-in `image_gen` |
| `cheer.png` | Shared mascot prompt. 1024×1024 transparent PNG; full-body mascot with both flippers raised in celebration, joyful open smile, both eyes open, a few simple sparkle shapes, centered with about 6% padding. | OpenAI built-in `image_gen` |
| `logo-badge.png` | Shared mascot prompt. 1024×1024 transparent PNG; head-and-shoulders signature winking penguin inside a clean circular badge, strong simple 48px-readable silhouette, thick white rim, light sky-blue fill, transparent outside the circle. | OpenAI built-in `image_gen` |
| `sky-town-header.png` | 1536×1024 opaque landscape header; bright blue sky and soft clouds above distant cozy Korean neighborhood rooftops, leafy trees, and low buildings along the lower third; soft watercolor/anime environmental style; smooth fade to exact white across the bottom edge; no characters, text, labels, or watermark. | OpenAI built-in `image_gen` |
| `town-map.png` | 1024×1536 opaque portrait top-down/gentle-isometric cozy neighborhood map; winding streets, small green park, stream and bridge, 6–8 small shops with colorful awnings; soft watercolor/anime environmental style; no characters, pins, labels, text, letters, or watermark. | OpenAI built-in `image_gen` |

Post-processing used Pillow only to resize generated square mascot assets to the requested 1024×1024 dimensions, normalize near-zero transparent pixels, and make the header's bottom edge exact `#FFFFFF`. No generated scene content was added or removed.

Delivered sizes: `apps/mobile/scripts/optimize-mascot-art.py` shrinks the 1024px originals in place for the app bundle (poses to 512px 128-colour alpha PNG, `sky-town-header.png` to 1080px wide, `town-map.png` at most 1080px wide). Re-running it on already optimized files is safe. The 1024px originals are not kept in the repository.

## Blink frames — 2026-10-01

약 160ms 동안 일반 포즈와 교체할 눈 감은 프레임 9개를 제작했다. 각 원본 `P.png`를 별도 편집 입력으로 제공하여 OpenAI built-in `image_gen`을 9회 사용했다. `sleep.png`는 이미 눈을 감았으므로 제외했고, `sky-town-header.png`와 `town-map.png`는 캐릭터가 아니므로 제외했다.

Shared blink prompt (verbatim; each call appended its table row's pose-specific instruction):

> Use case: precise-object-edit. Asset type: MassCOM mascot blink animation frame. Edit the supplied original PNG, preserving its canvas, exact pose, framing, proportions, watercolor texture, dark anime linework, royal-blue penguin body, white face/belly, green leaf, yellow beak/feet, blush, props and transparency. Change ONLY every OPEN glossy dark eye into a gently closed eye: replace the glossy blob with the surrounding white face and a single soft dark curved eyelid line, ends slightly higher than the middle (a shallow downward-dipping U arc), matching the original dark linework. Keep any already-winking/closed eye exactly as it is. Do not move or redraw anything else, do not add lashes, eyebrows, extra marks, text or a background. Preserve image alignment so the edited eyes sit at the original eye centers. Transparent background.

| File | Prompt | Tool |
| --- | --- | --- |
| `wave-blink.png` | Shared blink prompt. Pose-specific instruction: Only the viewer-left eye is open; close it. Keep the viewer-right wink exactly unchanged. | OpenAI built-in `image_gen` + Pillow |
| `explore-map-blink.png` | Shared blink prompt. Pose-specific instruction: Close both open eyes. Keep the folded map and all face features fixed. | OpenAI built-in `image_gen` + Pillow |
| `stamp-blink.png` | Shared blink prompt. Pose-specific instruction: Only the viewer-left eye is open; close it. Keep the viewer-right wink exactly unchanged. | OpenAI built-in `image_gen` + Pillow |
| `gift-blink.png` | Shared blink prompt. Pose-specific instruction: Close both open eyes. Preserve the gift, ribbon, blush and smiling beak. | OpenAI built-in `image_gen` + Pillow |
| `puzzled-blink.png` | Shared blink prompt. Pose-specific instruction: Close both open eyes. Keep the existing eyebrow and question-mark symbol exactly unchanged. | OpenAI built-in `image_gen` + Pillow |
| `friends-blink.png` | Shared blink prompt. Pose-specific instruction: There are TWO penguins, both with TWO open eyes: close all FOUR open eyes, including both eyes of the orange-scarf penguin. Preserve their high-five pose. | OpenAI built-in `image_gen` + Pillow |
| `search-blink.png` | Shared blink prompt. Pose-specific instruction: Close BOTH open eyes, explicitly including the LARGE eye visible THROUGH the magnifying-glass lens. The closed eyelid through the lens must retain its enlarged scale. Preserve every part of the lens rim, glass highlights and blush. | OpenAI built-in `image_gen` + Pillow |
| `cheer-blink.png` | Shared blink prompt. Pose-specific instruction: Close both open eyes. Preserve raised flippers and every sparkle. | OpenAI built-in `image_gen` + Pillow |
| `logo-badge-blink.png` | Shared blink prompt. Pose-specific instruction: Only the viewer-left eye is open; close it. Keep the viewer-right existing closed/winking arc exactly unchanged. Preserve the circular badge and rim. | OpenAI built-in `image_gen` + Pillow |

후처리는 Python + Pillow만 사용했다. 원본 흰 얼굴의 큰 어두운 광택 눈을 연결 성분으로 찾아 좌표를 고정했다. 생성본을 512×512로 LANCZOS 리사이즈한 뒤 눈꺼풀 선만 분리하고, 각 원본 눈의 폭과 중심에 맞춰 개별적으로 크기와 위치를 등록했다. 생성된 선이 위로 솟는 곡선인 경우 눈 부분만 수직 반전하여 가운데가 부드럽게 아래로 내려가는 곡선으로 보정했다. 선의 색은 해당 원본의 어두운 선 색으로 맞췄다. 생성된 몸통·얼굴 전체·소품·홍조는 붙여 넣지 않았다.

각 눈의 원래 광택 눈 부분을 주변 원본 얼굴색으로 복원한 작은 패치에 생성된 눈꺼풀 선을 합성했다. 눈 연결 성분 주변 2px의 안티앨리어싱 가장자리도 제거했고, `search.png`의 확대된 눈은 4px까지 제거했다. 눈 바운딩 박스에 각 방향 6px 여유를 둔 타원 마스크만 사용했으며, 중심 90%는 불투명하고 바깥 10%는 feather 처리했다. 원본을 베이스로 이 마스크 안의 패치만 합성해 몸·소품·배경 투명도와 기존 윙크를 유지했다. `friends-blink.png`는 두 펭귄의 네 눈, `search-blink.png`는 돋보기 속 확대된 눈까지 닫았다.

양자화는 전체 그림을 다시 처리하지 않고, 합성한 눈 패치만 해당 원본의 기존 128색 RGBA 팔레트에서 가장 가까운 색으로 매핑했다. 거리식은 RGB 제곱 거리 + alpha 제곱 거리의 4배다. 원본 팔레트와 PNG 투명도 표를 그대로 재사용하고 `optimize=True`로 저장하여 눈 밖 픽셀을 정확히 보존했다. 실제 원본 파일 모드는 `P`이므로 blink도 같은 `P` 모드의 512×512 128색 alpha PNG다. 두 파일 모두 RGBA로 디코딩되며, 별도의 32-bit RGBA 저장으로 모드를 변경하지 않았다.

검증 결과: 9/9 PASS. 모든 변경 픽셀은 해당 눈 타원 마스크 안에 있고 마스크 밖 변경은 0픽셀이다. 눈별 mask-weighted RGB mean absolute difference의 통과 기준은 0–255 범위에서 **20 초과**이며, 실제 값은 **90.03–132.64**다. 모든 blink 파일이 원본보다 작으며 원본 PNG들의 SHA-256은 작업 전후 동일하다. 기존 윙크와 눈썹 보존, `friends` 네 눈 및 `search` 확대 눈 닫힘은 contact sheet로 추가 확인했다. 앱에서 실제 160ms 재생은 NOT_RUN이다.

좌표는 왼쪽 위 원점의 `(x0,y0,x1,y1)`이며 오른쪽·아래 끝은 exclusive다. 표의 좌표는 마스크 전체가 아니라 실제로 변경된 픽셀들의 눈별 바운딩 박스다.

| File | Differing pixels | Changed regions | Eye RGB MAD | Original → blink bytes | Status |
| --- | ---: | --- | --- | ---: | --- |
| `wave-blink.png` | 952 | `(189,181,223,222)` | 111.55 | 19656 → 19465 | PASS |
| `explore-map-blink.png` | 1817 | `(181,196,213,234); (288,217,324,256)` | 107.4, 108.62 | 15605 → 15306 | PASS |
| `stamp-blink.png` | 868 | `(213,182,246,220)` | 110.04 | 18007 → 17859 | PASS |
| `gift-blink.png` | 1673 | `(211,170,243,205); (314,193,348,232)` | 103.36, 106.88 | 20399 → 20063 | PASS |
| `puzzled-blink.png` | 1786 | `(196,215,230,254); (308,188,341,226)` | 110.45, 105.31 | 20554 → 20216 | PASS |
| `friends-blink.png` | 2080 | `(101,219,129,248); (176,197,201,225); (316,199,341,226); (388,221,416,251)` | 94.03, 90.84, 90.03, 98.63 | 21034 → 20591 | PASS |
| `search-blink.png` | 3761 | `(172,163,232,226); (311,204,350,247)` | 132.64, 110.67 | 23814 → 23092 | PASS |
| `cheer-blink.png` | 2027 | `(180,202,216,243); (297,181,335,222)` | 112.44, 111.32 | 22242 → 21849 | PASS |
| `logo-badge-blink.png` | 2019 | `(151,240,203,297)` | 125.7 | 26562 → 26093 | PASS |

Human-review contact sheet (각 포즈 원본 | blink, 밝은 회색 배경):

`/private/tmp/claude-501/-Users-choi-Desktop-MassCOM/703ef01c-8797-4b99-8051-5237a53b1118/scratchpad/blink-contact-sheet.png`

재검증 명령 (저장소 루트에서 실행; 파일을 쓰지 않는다):

```bash
python3 - <<'PY'
from pathlib import Path
from math import hypot
from PIL import Image
root = Path("apps/mobile/assets/images/mascot/v2")
masks = {"wave":[[184,177,229,227]],"explore-map":[[176,191,219,239],[282,212,329,261]],"stamp":[[208,176,251,225]],"gift":[[206,165,248,210],[309,187,353,236]],"puzzled":[[191,210,236,259],[303,182,346,231]],"friends":[[96,214,134,252],[171,192,206,229],[311,193,346,231],[383,216,421,255]],"search":[[169,160,238,231],[306,199,355,251]],"cheer":[[175,197,221,247],[292,176,340,227]],"logo-badge":[[146,236,208,302]]}

def weight(x, y, box):
    x0, y0, x1, y1 = box
    r = hypot((x + .5 - (x0 + x1) / 2) / ((x1 - x0) / 2),
              (y + .5 - (y0 + y1) / 2) / ((y1 - y0) / 2))
    return round(255 * max(0, min(1, (1 - r) / .10))) / 255

for pose, boxes in masks.items():
    original_path, blink_path = root / f"{pose}.png", root / f"{pose}-blink.png"
    original, blink = Image.open(original_path), Image.open(blink_path)
    assert original.size == blink.size == (512, 512)
    assert original.mode == blink.mode == "P"
    assert original.getpalette() == blink.getpalette()
    assert original.info["transparency"] == blink.info["transparency"]
    a, b = original.convert("RGBA"), blink.convert("RGBA")
    assert len(b.getcolors(512 * 512)) <= 128
    assert blink_path.stat().st_size <= 2 * original_path.stat().st_size
    ap, bp = a.load(), b.load()
    changed = [(x, y) for y in range(512) for x in range(512) if ap[x, y] != bp[x, y]]
    assert changed and all(any(weight(x, y, box) > 0 for box in boxes) for x, y in changed)
    bounds, means = [], []
    for box in boxes:
        x0, y0, x1, y1 = box
        region = [(x, y) for x, y in changed if x0 <= x < x1 and y0 <= y < y1]
        assert region
        bounds.append((min(x for x, y in region), min(y for x, y in region),
                       max(x for x, y in region) + 1, max(y for x, y in region) + 1))
        weighted_difference = total_weight = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                w = weight(x, y, box)
                weighted_difference += w * sum(abs(ap[x, y][c] - bp[x, y][c]) for c in range(3)) / 3
                total_weight += w
        mad = weighted_difference / total_weight
        assert mad > 20
        means.append(round(mad, 2))
    print(f"PASS {pose}: pixels={len(changed)}, boxes={bounds}, RGB_MAD={means}, "
          f"bytes={original_path.stat().st_size}->{blink_path.stat().st_size}, outside_masks=0")
PY
```
