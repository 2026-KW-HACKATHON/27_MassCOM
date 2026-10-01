# MassCOM shop art sources

Generated on 2026-10-01 with OpenAI built-in `image_gen`. These are the blue penguin guide's neighborhood friends and shop icons in the same sky-town world.

Style references read and visually inspected before generation:

- `apps/mobile/assets/images/mascot/v2/SOURCES.md` — shared mascot prompt and rendering constraints
- `apps/mobile/assets/images/mascot/v2/wave.png` — proportions, face, colored linework, watercolor and leaf shape
- `apps/mobile/assets/images/mascot/v2/cheer.png` — glossy eyes, blush, bright daylight palette and paper texture
- `docs/assets/readme/hero.png` — sky-town palette and neighborhood illustration family

Shared neighborhood-friend prompt:

> Use case: illustration-story. MassCOM Android app shop asset. The three supplied images are STYLE REFERENCES ONLY: wave and cheer establish the exact watercolor rendering, line weight, face design and chubby proportions; hero establishes the bright sky-town palette. Draw a NEW neighbor character, not a penguin and not the reference image itself. Match the same soft watercolor with clean anime linework, bright daylight palette, gentle paper texture inside the subject only, saturated but soft color, thin clean colored outlines, very round chubby body, oversized rounded head, tiny rounded paws/feet, big glossy dark eyes with small white catchlights, pink blush cheeks and joyful friendly smile. Simple readable silhouette, minimal small details, no photorealism, no 3D rendering, no vector-flat styling, no heavy dark outlines. Exactly ONE isolated asset, 1024×1024 transparent PNG, full body centered with the entire character and every prop visible, subject including all props fitting inside an 88% square with about 6% transparent padding all around. No backdrop, scenery, floor, ground shadow, shadow box, halo or sticker rim. Actual alpha transparency. No text, letters, numerals, logos, watermarks or brand marks anywhere. Do not include the blue penguin.

Shared shop-icon prompt for the initial bronze chest and mileage coin:

> Use case: illustration-story. MassCOM Android app shop icon. Supplied images are STYLE REFERENCES ONLY: wave and cheer establish soft watercolor with clean anime linework, bright daylight palette, thin clean colored outlines and gentle paper texture; hero establishes cheerful sky-town palette. Draw ONE NEW isolated object icon matching that rendering. Rounded chubby object shapes, soft painted highlights, warm gentle gradients and watercolor texture INSIDE THE OBJECT ONLY. Simple small-screen readable design, minimal details. No characters or faces. 1024×1024 genuinely transparent PNG, centered composition, entire icon including attached symbols fitting in an 88% square with about 6% transparent padding. No backdrop, floor, ground shadow, shadow box, halo, white sticker rim or colored panel. No text, letters, numerals, logos, watermarks or brand marks anywhere. A small natural leaf symbol matching the penguin's single green leaf is the only emblem allowed. No paw prints, no currency signs. Not photorealistic, not 3D, not flat vector.

The silver and gold editions use the generated bronze chest as their composition target, plus the same three visual references. Their prompts preserve the ticket, leaf and refresh arrow while changing the metal colors.

| File | Prompt | Tool | Post-processing |
| --- | --- | --- | --- |
| `friend-cook-cat.png` | Shared neighborhood-friend prompt. Subject: A cute warm cream-and-orange cat wearing a white chef hat, holding one small pot with two paws and a few curls of steam rising from it. Both rounded feet visible; natural easy pose. Local restaurant neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-cafe-bear.png` | Shared neighborhood-friend prompt. Subject: A cute brown bear wearing a plain leaf-green apron and holding one small white coffee cup in its two paws. Both rounded feet visible. Local café neighbor. Apron and cup completely blank. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-walk-rabbit.png` | Shared neighborhood-friend prompt. Subject: A cute white rabbit wearing a small soft green hiking hat and a tiny ochre backpack clearly visible at its side, smiling ready for a neighborhood walk. Two rounded ears, two arms and both rounded feet visible. Local walking-trail neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-bakery-squirrel.png` | Shared neighborhood-friend prompt. Subject: A cute warm russet squirrel with a large round fluffy curled tail visible beside its body, holding ONE fresh golden baguette diagonally with its two small paws. A few simple baked slash marks on the bread, no wrapper. Both rounded feet visible. Local bakery neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-flower-hedgehog.png` | Shared neighborhood-friend prompt. Subject: A cute chubby hedgehog, cream face and belly with soft rounded brown spines around its head and back, holding ONE small bouquet of simple pink, white and yellow flowers with green stems in both paws. Friendly big glossy eyes; both tiny rounded feet visible. Spines are few, rounded, never sharp or detailed. Local florist neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-book-owl.png` | Shared neighborhood-friend prompt. Subject: A cute chubby warm brown-and-cream owl wearing thin round glasses around two big glossy dark eyes, holding ONE closed plain deep teal book in its two rounded wings. Front cover is perfectly blank, no writing or decorative logo. Small orange beak and both little rounded orange feet visible. Local bookshop neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-tteok-tiger.png` | Shared neighborhood-friend prompt. Subject: A cute chubby BABY tiger with soft golden orange fur, cream muzzle and belly, a few rounded brown tiger stripes, pink cheeks and big glossy eyes, holding ONE small pale ceramic plate of Korean rice cakes (white short cylindrical garaetteok, round white and pink rice cakes, a green songpyeon) in both paws. No sauce, no dumplings, no bread. Both tiny rounded feet visible; a curved striped tail at its side. Local Korean rice-cake-shop neighbor. Final forehead correction described below. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-market-raccoon.png` | Shared neighborhood-friend prompt. Subject: A cute chubby grey raccoon with a soft charcoal face mask, cream muzzle and belly, a short fluffy striped tail at its side, carrying ONE small wicker market basket of vegetables (carrot, leafy cabbage, green cucumber) in its two rounded paws. Big glossy eyes visible inside the mask, friendly smile, pink cheeks, both rounded feet visible. Local neighborhood market neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `friend-laundry-seal.png` | Shared neighborhood-friend prompt. Subject: A cute chubby light cool-grey baby seal, round head and body, cream face and belly, big glossy eyes, pink cheeks, tiny whiskers and friendly smile, holding ONE neatly folded mint-green towel across its front with TWO short rounded side flippers. Its two little rear flippers visible at the bottom. Three small translucent soap bubbles near its shoulders. No human legs, no extra limbs. Local laundry neighbor. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `ticket-bronze.png` | Shared shop-icon prompt. Subject: ONE small rounded treasure chest made from warm copper-bronze metal, with bronze panels and deeper bronze bands, shown in gentle three-quarter front view. Lid slightly open; ONE plain ivory admission ticket protrudes from the opening. Ticket has simple rounded notches, NO writing and NO decorative stamped symbols. Front clasp has ONE small green leaf emblem, like the reference mascot's single leaf. Beside the top right of the chest, ONE compact clean leaf-green circular refresh arrow: a curved stroke making almost a full circle and ONE clear arrowhead, with transparent center. Chest, ticket, leaf and circular arrow must all remain readable. No coins or treasure pile, no wood, no paw-print emblem. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `ticket-silver.png` | Use case: precise-object-edit. Image 1 is the bronze chest artwork to use as the exact composition target. Images 2–4 are watercolor style references. Produce ONE silver edition of this chest icon as a new 1024×1024 transparent PNG. Change ONLY the chest metal colors to cool silver: softly painted light silver-grey panels, brighter silver bands, deeper blue-grey silver seams and soft daylight highlights. Every chest component including the front clasp and rivets must be SILVER, not bronze or gold. Preserve the chest silhouette, rounded proportions, perspective, clean colored line weight, watercolor and gentle paper texture, slightly open lid, single blank ivory ticket with rounded notches, single green leaf emblem at the front and single green circular refresh arrow at the upper right. Do not change the green leaf or arrow, ivory ticket or their positions. Reproduce its cheerful bright daylight rendering. Centered with about 6% transparent padding around ALL content. Genuinely transparent alpha background; no backdrop, floor, ground shadow, shadow box, glow, halo or sticker rim. No text, letters, numbers, logos, watermarks, brand marks, currency signs or paw prints. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `ticket-gold.png` | Use case: precise-object-edit. Image 1 is the bronze chest artwork to use as the exact composition target. Images 2–4 are watercolor style references. Produce ONE gold edition of this chest icon as a new 1024×1024 transparent PNG. Change ONLY the chest metal colors to warm GOLD: softly painted golden-yellow panels, bright gold bands, deeper ochre-gold seams and soft daylight highlights. Every chest component including the front clasp and rivets must be GOLD. Preserve the chest silhouette, rounded proportions, perspective, clean colored line weight, watercolor and gentle paper texture, slightly open lid, single blank ivory ticket with rounded notches, single green leaf emblem at the front and single green circular refresh arrow at the upper right. Do not change the green leaf or arrow, ivory ticket or their positions. Reproduce its cheerful bright daylight rendering. Centered with about 6% transparent padding around ALL content. Genuinely transparent alpha background; no backdrop, floor, ground shadow, shadow box, glow, halo or sticker rim. No text, letters, numbers, logos, watermarks, brand marks, currency signs or paw prints. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |
| `mileage-coin.png` | Shared shop-icon prompt. Subject: ONE round golden coin nearly front-facing with just a slight view of its thick rounded edge, bright warm gold rim, subtle soft highlights, centered simple raised green leaf emblem shaped like the penguin's single leaf with one fine central vein. No face, no letters, no numbers, no currency symbols. Entire clean round gold coin fully visible. No additional coins, no ticket, no arrows, no ribbon, no sparkles. | OpenAI built-in `image_gen` | Pillow: alpha cleanup, centered 1024×1024 normalization, 512×512 LANCZOS, 128-color FASTOCTREE, no dithering, optimized PNG. |

Post-processing follows the square-asset settings in `apps/mobile/scripts/optimize-mascot-art.py` without running or changing that script:

1. Every call requested a 1024×1024 transparent PNG. The built-in tool actually returned 1254×1254 RGBA images; this resolution mismatch is recorded rather than describing the raw files as 1024px.
2. Normalize almost invisible alpha values 0–8 to 0, crop only the resulting transparent bounds, preserve aspect ratio, and fit the longest content edge to 900px on a transparent 1024×1024 canvas. This establishes approximately 6% minimum padding; it does not paint or replace the background.
3. Resize the normalized canvas to 512×512 using Pillow LANCZOS. Normalize alpha 0–8 to 0 again after resampling.
4. Use `quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)` and `save(..., optimize=True)`, exactly the existing mascot optimizer's palette settings. The PNG mode is `P` with a `tRNS` alpha table; decoded mode is RGBA. FASTOCTREE averages alpha within palette entries, so maximum alpha is 253–254 rather than exactly 255, as can also happen with the existing optimizer.

No source originals or intermediate 1024px files are kept in this directory. No generated scene content was added or removed during post-processing.

Regeneration: `friend-tteok-tiger.png` was regenerated once because the connected forehead stripes looked like a written character. A targeted `image_gen` edit removed only that mark, retaining the pose, side/body stripes, plate and rice cakes. The final forehead is plain orange fur.

Exact correction prompt:

> Use case: precise-object-edit. The FIRST reference is the baby tiger asset to correct; the other references establish the exact watercolor style. Change ONLY its forehead: REMOVE the connected brown mark entirely so the central forehead is plain golden-orange fur. Do not draw any joined lines, ideographs, lettering, character-shaped pattern or forehead emblem. Retain short separate cheek stripes, body stripes and tail stripes, the entire cute chubby tiger identity, glossy eyes, blush, soft watercolor, clean anime linework, gentle paper texture, exact pose, two paws holding the plate and exactly the existing white, pink and green Korean rice cakes. No words, letters, numbers, logos, watermark or brand marks anywhere. Full body centered, both feet and tail visible, with about 6% transparent padding on all sides. 1024×1024 genuinely transparent PNG, no backdrop, floor, shadow box, ground shadow or sticker rim. Do not add extra objects or characters.

Visual inspection: the round bodies, glossy eyes, pink cheeks, colored outlines and watercolor texture match the reference family. Minor variations: some species have brown-black eyes rather than blue-black; the seal has softer pale shading; the metal icons have stronger painted highlights. No final asset has text, letters, logos, watermarks, paw-print emblems, backdrops, floors or shadow boxes. Filenames on the contact sheet are review labels, not part of the delivered assets.

Verification result: **PASS** for all 13 PNGs. Each has 512×512 dimensions, mode `P` with alpha, exactly 128 used palette entries, corner alpha `[0, 0, 0, 0]`, and at least a 31px transparent margin on every side. Padding below is left/top/right/bottom.

| File | Bytes | KiB | Size / mode | Used colors | Corner alpha | Padding (px) |
| --- | ---: | ---: | --- | ---: | --- | --- |
| `friend-cook-cat.png` | 28058 | 27.4 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 73 / 31 / 73 / 31 |
| `friend-cafe-bear.png` | 32020 | 31.3 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 92 / 31 / 92 / 32 |
| `friend-walk-rabbit.png` | 22759 | 22.2 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 80 / 31 / 81 / 31 |
| `friend-bakery-squirrel.png` | 41740 | 40.8 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 31 / 34 / 31 / 34 |
| `friend-flower-hedgehog.png` | 36594 | 35.7 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 54 / 31 / 54 / 31 |
| `friend-book-owl.png` | 38569 | 37.7 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 78 / 31 / 78 / 31 |
| `friend-tteok-tiger.png` | 31755 | 31.0 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 72 / 31 / 73 / 31 |
| `friend-market-raccoon.png` | 39385 | 38.5 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 77 / 31 / 77 / 31 |
| `friend-laundry-seal.png` | 32563 | 31.8 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 46 / 31 / 46 / 31 |
| `ticket-bronze.png` | 48530 | 47.4 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 34 / 31 / 34 / 31 |
| `ticket-silver.png` | 47018 | 45.9 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 38 / 31 / 38 / 31 |
| `ticket-gold.png` | 46331 | 45.2 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 31 / 31 / 32 / 32 |
| `mileage-coin.png` | 41576 | 40.6 | 512×512 / P + alpha | 128 | 0 / 0 / 0 / 0 | 31 / 31 / 31 / 32 |

Total delivered PNG size: 486898 bytes (475.5 KiB).

Contact sheet: `/private/tmp/claude-501/-Users-choi-Desktop-MassCOM/703ef01c-8797-4b99-8051-5237a53b1118/scratchpad/shop-art-sheet.png` — all 13 assets, light grey `#ECEFF1`, 1184×1264 RGB PNG. Rows 1–3 are bronze/silver/gold friends; row 4 contains bronze/silver/gold chests and the coin.

Re-runnable final-file check from the worktree root:

```bash
python3 - <<'PY'
from pathlib import Path
from PIL import Image
root = Path('apps/mobile/assets/images/shop')
files = sorted(root.glob('*.png'))
assert len(files) == 13
for path in files:
    im = Image.open(path)
    assert im.size == (512, 512) and im.mode == 'P'
    assert 'transparency' in im.info and len(im.getcolors(256)) == 128
    alpha = im.convert('RGBA').getchannel('A')
    assert all(alpha.getpixel(p) == 0 for p in [(0,0),(511,0),(0,511),(511,511)])
    x0, y0, x1, y1 = alpha.getbbox()
    assert min(x0, y0, 512-x1, 512-y1) >= 31
    print(path.name, im.size, im.mode, path.stat().st_size)
print('PASS: 13 transparent, 128-color, 512px PNGs')
PY
```

Visual verdict retained here because this task permits workspace writes only inside the shop asset directory:

```json
{
  "score": 94,
  "verdict": "pass",
  "category_match": true,
  "differences": [
    "Several animal eyes use warm brown-black rather than the penguin's blue-black.",
    "Seal has softer pale shading; metal icons have brighter highlights than the penguin."
  ],
  "suggestions": [],
  "reasoning": "All 13 assets remain within the reference watercolor/anime family, with consistent round shapes, clean colored linework and simple props. Tiger's text-like forehead mark was corrected; no final asset contains lettering, brand marks, backdrops or floors."
}
```

