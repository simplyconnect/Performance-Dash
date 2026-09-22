import base64, re, json, pathlib

root = pathlib.Path('/home/claude/sc')
out = pathlib.Path('/home/claude/sc_publish/dashboard.html')
out.parent.mkdir(exist_ok=True)

html = (root/'index.html').read_text()
css = (root/'assets/css/styles.css').read_text()
data_js = (root/'assets/js/data.js').read_text()
charts_js = (root/'assets/js/charts.js').read_text()
app_js = (root/'assets/js/app.js').read_text()
config_js = 'window.SC_CONFIG = { feedUrl: null };'
sample = json.loads((root/'data/sample-data.json').read_text())

def b64(p):
    return base64.b64encode((root/p).read_bytes()).decode()

logo = b64('assets/img/logo.png')
icon = b64('assets/img/logo-icon.png')

html = html.replace('<link rel="stylesheet" href="assets/css/styles.css" />', f'<style>\n{css}\n</style>')
html = html.replace('assets/img/logo-icon.png', f'data:image/png;base64,{icon}')
html = html.replace('assets/img/logo.png', f'data:image/png;base64,{logo}')

# swap DataEngine.load(url) fetch-based bootLoad for inline data with the same ingest() path
app_js_pub = app_js.replace(
    "async function bootLoad(feedUrl) {\n    showBoot(true);\n    try {\n      if (feedUrl) {\n        await DataEngine.load(feedUrl);\n        showSourceBanner('live', feedUrl);\n      } else {\n        await DataEngine.load(SAMPLE_URL);\n        showSourceBanner('sample');\n      }\n    } catch (err) {",
    "async function bootLoad(feedUrl) {\n    showBoot(true);\n    try {\n      if (feedUrl) {\n        await DataEngine.load(feedUrl);\n        showSourceBanner('live', feedUrl);\n      } else {\n        DataEngine.ingest(window.SC_SAMPLE_DATA);\n        showSourceBanner('sample');\n      }\n    } catch (err) {"
)
assert app_js_pub != app_js, "patch did not apply"
# fallback path also calls DataEngine.load(SAMPLE_URL) - patch that too
app_js_pub = app_js_pub.replace(
    "      try {\n        await DataEngine.load(SAMPLE_URL);\n        showSourceBanner('error-fallback', feedUrl, err.message);\n      } catch (err2) {",
    "      try {\n        DataEngine.ingest(window.SC_SAMPLE_DATA);\n        showSourceBanner('error-fallback', feedUrl, err.message);\n      } catch (err2) {"
)

sample_json = json.dumps(sample, separators=(',', ':'))

scripts_block = f"""<script>window.SC_SAMPLE_DATA = {sample_json};</script>
<script>{config_js}</script>
<script>{data_js}</script>
<script>{charts_js}</script>
<script>{app_js_pub}</script>"""

html = re.sub(
    r'<script src="assets/js/config\.js"></script>\s*<script src="assets/js/data\.js"></script>\s*<script src="assets/js/charts\.js"></script>\s*<script src="assets/js/app\.js"></script>',
    lambda m: scripts_block, html
)
assert 'src="assets/js' not in html, "script tags not replaced"

out.write_text(html)
print("bytes:", out.stat().st_size)
