<p align="center">
    <img src="./chrome/assets/128x128.png" alt="Blackbaud Next" width="120">
</p>

# Blackbaud Next

A Chrome extension that supercharges the Blackbaud student portal with quality-of-life features students actually use.

## Download

Get it on the [Chrome Web Store](https://chromewebstore.google.com/detail/ofadcfkogaiddhcmbabpgidjimnkfkij).

## Why Blackbaud Next?

Blackbaud's student portal works, but it has rough edges. Pages break, layouts are narrow, the login flow is slow, and simple things like copying a class roster take too many clicks. Blackbaud Next can run the original site unchanged, enhance the native Blackbaud UI, or mount the experimental Orbit UI layer.

## UI Modes

| Mode         | What It Does                                      |
| ------------ | ------------------------------------------------- |
| **Normal**   | Use the unmodified Blackbaud UI                   |
| **Enhanced** | Use native Blackbaud with Blackbaud Next features |
| **Orbit**    | Mount the experimental Orbit UI host              |

## Features

Features are toggleable from the extension popup:

| Toggle                    | What It Does                                    |
| ------------------------- | ----------------------------------------------- |
| **Automatic Login**       | Skip extra login steps                          |
| **Optimize Login Page**   | Clean up the login flow                         |
| **Loading Overlay**       | Show loading indicator between page transitions |
| **Fix Empty Favicon**     | Add a proper tab icon                           |
| **Old Assignment Center** | Revert to previous assignment center            |
| **Roster Tools**          | Copy class rosters easily                       |
| **Download Full Avatar**  | Download full-resolution profile pictures       |
| **Fix Invalid Pages**     | Patch broken assignment pages                   |

## Source Layout

```text
chrome/src/
  boot/            # startup and mode selection
  auth/            # Blackbaud/Google login helpers
  native/          # native shell visibility and fallback controls
  sources/         # API, network, and DOM source adapters
  data/            # stable model and normalizer helpers
  legacy-patches/  # native Blackbaud enhancement modules
  orbit/           # Orbit host placeholder
  popup/           # extension popup
  shared/          # settings, routes, DOM, clipboard utilities
```

## Developing Locally

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome/` directory in this project

The extension loads immediately. Toggle features in the popup and refresh Blackbaud pages to see changes.

## Requirements

- **Chrome 148+**
- Works on any school using `*.myschoolapp.com`

## License

MIT. See [LICENSE](LICENSE) for details.
