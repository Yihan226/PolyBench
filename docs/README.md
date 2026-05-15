# PolyBench GitHub Pages Site

This directory is a static GitHub Pages site with two entry points:

- `index.html`: public PolyBench results dashboard and leaderboard
- `experts.html`: browser-only expert answering interface with local progress and JSON export

## Rebuild Data

From the repository root:

```bash
python3 utils/build_pages_data.py
```

The script reads `data/*/{mcq,qa}.jsonl`, keeps full-corpus summary statistics
and leaderboard context, then writes a lightweight expert quiz bundle to
`docs/assets/data/polybench-data.js`.

By default, the exported `questions` array contains 100 MCQ examples and 100 QA
examples. Change `EXAMPLE_LIMIT_PER_TYPE` or replace the `questions` array if
you want to publish a different quiz set.

## Deploy On GitHub Pages

1. Push this repository to GitHub.
2. Open repository settings.
3. Go to Pages.
4. Set the source to the branch you use and the `/docs` folder.
5. Save. GitHub will serve `docs/index.html` as the site root.

The expert page is fully static. It stores answers in the browser and exports a
JSON file; collecting submissions centrally needs a backend endpoint or form
integration.
