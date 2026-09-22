# Simply Connect — Performance Dashboard

Ek interactive, mobile-friendly performance dashboard (Calls + Sales) — abhi sample data (aapki uploaded Excel se, PII hata kar) se chal raha hai, aur ek click mein live Google Sheet se bhi chal sakta hai.

## Ye kya kar sakta hai
- **KPIs**: Total calls, answered, AHT, abandoned, sales closed, RGUs, conversion rate, points — sab % change ke saath (pichle period se).
- **Service Level ring**, **Call Result breakdown**, **Call Volume trend** (daily/weekly/monthly, aur Answered-vs-Abandoned view), **Outcome mix bubbles**.
- **Top Queues leaderboard** — click karke filter lagta hai.
- **Call Activity Heatmap** — din/ghante ke hisaab se busiest time dikhata hai.
- **Agent Performance table** — sortable, searchable, paginated.
- **Sales Performance**: provider donut, team-wise bars, aur pura sales log table.
- **Filters**: date range (presets + custom), Queue / Agent / Result multi-select, sab kuch ek dusre se sync.
- **Export CSV**, **Dark/Light mode**, fully responsive (desktop → mobile), search bar (agent/queue).

## Files
```
index.html              ← main dashboard page
assets/css/styles.css   ← all styling (light + dark theme)
assets/js/data.js       ← data loading & filtering engine
assets/js/charts.js     ← custom SVG charts (no external chart library)
assets/js/app.js        ← dashboard logic / UI wiring
assets/js/config.js     ← paste your live Google Sheet URL here (optional)
assets/img/             ← your logo files
data/sample-data.json   ← PII-free sample data built from your uploaded Excel
apps-script/Code.gs      ← Google Apps Script backend (Sheet → JSON feed)
apps-script/README.md    ← step-by-step: Sheet → Apps Script → GitHub → Vercel
scripts/build_sample.py ← rebuilds data/sample-data.json from any similarly-shaped Excel export
```

## Turant preview
Koi build step nahi chahiye — sirf `index.html` ko kisi static server se serve karein (double-click se `file://` open na karein, fetch() kaam nahi karega):
```bash
python3 -m http.server 8080
# phir browser mein: http://localhost:8080
```

## Live Google Sheet se connect karna
Poori detail `apps-script/README.md` mein hai. Chhota summary:
1. `apps-script/Code.gs` ko apni Sheet ke Apps Script editor mein paste karein.
2. **Deploy ▸ Web app** karein → URL milega.
3. Dashboard ke 🔌 **Connect data** button mein woh URL paste karein (ya `assets/js/config.js` mein permanently set kar dein).

## GitHub + Vercel
1. Ye poora folder GitHub repo mein push karein.
2. Vercel par **Import Project** → is repo ko select karein → Framework: **Other**, build command khaali → **Deploy**.
3. Bas, live URL mil jayega. Sheet update hoga → dashboard khud refresh ho kar naya data dikhayega (top-right ka Refresh button ya page reload par).
