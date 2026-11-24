# Prompty — Brand Assets Brief

## Repository Understanding

**Project**: Prompty — Global Prompt Library Browser Extension  
**Tagline**: "Your prompts, one keystroke away on any site."  
**One-sentence**: A local-first, cross-browser (Chrome MV3 + Firefox MV3) extension that keeps your AI prompt library one keystroke away — in ChatGPT, Claude, Gemini, Perplexity, Higgsfield, or any plain textarea on the web.

**Audience**: Developers, AI engineers, prompt engineers, content creators, video creators using AI tools  
**Value Proposition**: Local-first (no accounts, no cloud, no telemetry), encrypted at rest (Vault Mode), agent-bridge for coding agents, cinematic starter library, variables, shot composer, model dialects.

## Visual Metaphor: "Infinite Library + Keystroke"

**Primary Metaphor**: An infinite, organized library of prompt cards that opens instantly with a keystroke — each card a prompt with variables, categories, and cinematic grammar. The "keystroke" (Alt+P, !, Ctrl+K) is the portal.

**Secondary Metaphors**:
- **Vault**: Encrypted, secure, local-only (AES-GCM, PBKDF2)
- **Infinite Scroll**: Prompts organized by category, searchable, filterable
- **Keystroke Portal**: Alt+P / ! / Ctrl+K opens the library instantly
- **Cross-device**: Same library everywhere (Chrome + Firefox)

## Art Direction: "Premium Product / Editorial / Dark UI Glassmorphism"

**Style Keywords**: Premium minimal, developer-first, high contrast, editorial cinematic, dark UI glassmorphism, Apple Keynote quality

**Materials**: Carbon fiber, dark acrylic, glass, brushed aluminum, holograms  
**Lighting**: Orange rim light (#ff6a00), studio lighting, volumetric glow  
**Atmosphere**: Premium, precise, developer-focused, cinematic depth

## Color Palette (Locked)

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#090909` | Primary dark |
| Secondary | `#111111` | Panels, cards |
| **Orange Accent** | `#ff6a00` | **Primary brand** — CTAs, highlights, rim lighting |
| White | `#ffffff` | Primary text |
| Gray | `#7b7b7b` | Muted text |

## Assets to Generate

### 1. GitHub Repository Banner (1500×500)
**Layout**:
- **Left (60%)**: 
  - Project name: "Prompty"
  - Tagline: "Global Prompt Library"
  - Value prop: "Your prompts, one keystroke away on any site."
  - 4 feature bullets:
    - ✦ Local-first · No cloud · No telemetry
    - ✦ Variables · Shot Composer · Model Dialects
    - ✦ Vault Mode (AES-GCM) + Agent Bridge (MCP)
    - ✦ Chrome MV3 + Firefox MV3 · Open Source
- **Right (40%)**: Hero illustration — infinite library of prompt cards fanning out from a central keystroke portal, orange rim lighting
- **Bottom**: "Dream-Pixels-Forge · Open Source · github.com/Dream-Pixels-Forge/prompty"

### 2. Open Graph Image (1280×640)
**Layout**:
- **Background**: Deep black `#090909` with subtle vignette
- **Center**: Prompty logotype + "Global Prompt Library" 
- **Subtitle**: "Your prompts, one keystroke away on any site."
- **Visual**: 3-4 prompt cards fanning from center, each showing variable chips `{subject}`, `{lens:24mm|50mm}`, orange accent borders
- **Bottom**: "Dream-Pixels-Forge" + orange accent line
- **Alt text**: "Prompty banner: your prompts, everywhere, one keystroke away."

### 3. Landing Page Hero Illustration (for docs/index.html)
**Usage**: Replace CSS gradient hero with illustrated hero
**Layout**:
- **Center**: Prompty logotype + "Your prompts, one keystroke away on any site."
- **Visual**: Infinite library perspective — prompt cards receding into depth, each card showing category icons, variable chips, orange accent highlights
- **Foreground**: Keystroke portal (Alt+P / ! / Ctrl+K) glowing orange
- **Lighting**: Orange volumetric glow from center, rim lighting on cards
- **Mood**: Premium, infinite depth, developer-magic

## Technical Requirements

| Asset | Dimensions | Format | File Name |
|-------|------------|--------|-----------|
| GitHub Banner | 1500×500 | PNG | `github-banner.png` |
| Open Graph | 1280×640 | JPG (85% quality) | `og.jpg` |
| Hero Illustration | 1920×1080 | PNG (transparent bg) | `hero-illustration.png` |

## Implementation Notes

1. **GitHub Banner**: Upload to repo settings → "Social preview" → Upload `github-banner.png`
2. **Open Graph**: Place `og.jpg` in `assets/` and update `docs/index.html` meta tag (currently points to missing `og.jpg`)
3. **Hero Illustration**: Replace CSS gradient in `.hero` section of `docs/index.html` with `<img src="assets/hero-illustration.png" alt="...">` or CSS background-image

## Animation Ideas (Optional)

- **GitHub Banner**: Subtle parallax on scroll (cards shift slightly)
- **OG Image**: Subtle orange glow pulse on card borders (2s loop)
- **Hero**: Cards gently float (3s ease-in-out), keystroke portal pulses (1.5s)

---

**Quality Check**: Each asset must be understandable in 3 seconds, show strong visual metaphor, premium composition, and Dream-Pixels-Forge branding.