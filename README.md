<p align="center">
    <img src="./chrome/assets/128x128.png" alt="Blackbaud Next" width="120">
</p>

# Blackbaud Next

A Chrome extension that supercharges the Blackbaud student portal with quality-of-life features students actually use.

## Download

Get it on the [Chrome Web Store](https://chromewebstore.google.com/detail/ofadcfkogaiddhcmbabpgidjimnkfkij).

## Why Blackbaud Next?

Blackbaud's student portal works, but it has rough edges. Pages break, layouts are narrow, the login flow is slow, and simple things like copying a class roster take too many clicks. Blackbaud Next patches all of that on top of the existing site.

## Features

All features are toggleable from the extension popup:

| Toggle                    | What It Does                                    |
| ------------------------- | ----------------------------------------------- |
| **Automatic Login**       | Skip extra login steps                          |
| **Optimize Login Page**   | Clean up the login flow                         |
| **Loading Overlay**       | Show loading indicator between page transitions |
| **Wide Layout**           | Expand narrow center column                     |
| **Fix Empty Favicon**     | Add a proper tab icon                           |
| **Old Assignment Center** | Revert to previous assignment center            |
| **Roster Tools**          | Copy class rosters easily                       |
| **Download Full Avatar**  | Download full-resolution profile pictures       |
| **Fix Invalid Pages**     | Patch broken assignment pages                   |

## Developing Locally

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome/` directory in this project

The extension loads immediately. Toggle features in the popup and refresh Blackbaud pages to see changes.

## Requirements

- **Chrome 88+** or any Chromium-based browser (Edge, Brave, Arc)
- Works on any school using `*.myschoolapp.com`

## License

MIT. See [LICENSE](LICENSE) for details.
