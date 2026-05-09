# Reproducibility

Every generated image is traceable. Three layers of provenance:

## 1. Per-image sidecar JSON

Adjacent to each `img_NNNN.png` is `img_NNNN.json` containing:

```json
{
  "filename": "img_0001.png",
  "theme": "vintage pulp fantasy",
  "prompt": "1940s pulp magazine cover painting, lone barbarian on a windswept cliff…",
  "expansion_seed": "a3f9e21b4c87",
  "expansion_index": 0,
  "image_model": "grok-imagine-image-quality",
  "text_model_for_expansion": "grok-4.3",
  "provider": "xai",
  "resolution": "2k",
  "aspect_ratio": "16:9",
  "generated_at": "2026-05-08T14:23:11Z",
  "frameforge_version": "0.1.0"
}
```

## 2. Per-theme manifest.csv

`<library>/<theme_slug>/manifest.csv` flattens all sidecars into a single
table — convenient for spreadsheet review or pandas analysis.

## 3. Library-wide SQLite index

`<library>/themes.db` tracks which images are currently uploaded to the TV
(`tv_uploads` table). This is *operational* state, not provenance.

## What "reproducible" means here

Image generation is non-deterministic at the model level — xAI does not
expose a true RNG seed for `grok-imagine-image-quality` as of 2026-05-09.
What we *do* preserve:

- The exact prompt sent to the model (verbatim string).
- The expansion seed (deterministic from theme + count + version + day).
- All model identifiers and parameters.

Re-running the same theme on the same day with the same FrameForge version
will produce the same *prompt list*; the resulting images will be visually
similar but not byte-identical. For publication, cite the sidecar JSON of
the specific image used.

## Pinning model versions for a study

Override `Config.image_model = "grok-imagine-image-quality-2026-05-06"`
(date-pinned alias from xAI) to insulate against silent model upgrades
during a long-running data-collection period.
