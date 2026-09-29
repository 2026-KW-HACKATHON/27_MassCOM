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
