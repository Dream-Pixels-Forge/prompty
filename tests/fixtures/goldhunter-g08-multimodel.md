# GOLDHUNTER — Prompt sheets (G01–G08)

Multi-model prompt sheet for the AI short film GOLDHUNTER. Each shot can hold
one variant per video model (Muse, Seedance 2.5, Kling, neutral). Prompty
inserts the variant matching the active site.

## G08 — Love, then greed
**Refs:** 1 `@heroine` · 2 `@plate`
**Edit:** keep the pull-back under 2 s
**CHECK:** identity matches G01

```muse
SHOT: {heroine} reaches for {hero}, then he pulls back. Golden hour, rain on the lens, 35mm anamorphic. STOP. HARD CUT.
```
```seedance-2.5
{heroine} reaches for {hero}, then he pulls back. Golden hour, rain on the lens, 35mm anamorphic. At 2 seconds, match cut.
```
```kling
{heroine} reaches for {hero}, then he pulls back. Golden hour, rain on the lens, 35mm anamorphic.
```
```
{heroine} reaches for {hero}, then he pulls back. Golden hour, rain on the lens, 35mm anamorphic.
```

## G01 — The raindrop
**Refs:** 1 `@raindrop` · 2 `@eyelash`
**Edit:** macro pull-out, match cut on round shape
**CHECK:** raindrop is perfectly round

```muse
A single raindrop trembling on {hero}'s eyelash, macro, cinematic, 100mm. STOP.
```
```seedance-2.5
A single raindrop trembling on {hero}'s eyelash, macro, cinematic, 100mm.
```

## G03 — Neon sign
**Refs:** 1 `@neon` · 2 `@night-market`
**Edit:** whip pan transition
**CHECK:** neon is round, matches raindrop shape

```kling
{hero} under a round flickering neon sign, rain sliding down the face, night market.
```
```
{hero} under a round flickering neon sign, rain sliding down the face, night market.
```

## Not a shot
This heading is not a shot (no `## <ID> — Name` pattern) and should be ignored.

\`\`\`json
{ "not": "a shot variant" }
\`\`\`
