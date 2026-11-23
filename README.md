# Organiser Box Generator

Live app: https://swldnphotos.github.io/Organiser-Box-Generator/


A static site: `index.html` plus `geometry.js`. There is no build step or server code. three.js loads from the jsDelivr CDN, so visitors need an internet connection.

## Quick ways to host it
- **Netlify Drop:** go to app.netlify.com/drop and drag this folder onto the page. You get a public URL straight away.
- **GitHub Pages:** put the two files in a repository, then go to Settings → Pages → *Deploy from a branch* (main, / root).
- **Cloudflare Pages / Vercel:** create a project from that repository, or upload the folder directly. There's no build command; the output directory is `/`.
- **Your own web server or NAS:** copy both files into any folder it serves.

Serve it over http(s). Double-clicking `index.html` may work in some browsers, but serving it is more reliable.
For a local test, run `python3 -m http.server` in this folder and open http://localhost:8000.

Layouts are saved in each visitor's own browser (localStorage). Downloads are normal browser downloads (a zip of STL/STEP files).
