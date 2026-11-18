# Gradient

An independent recreation of [Photo Gradient](https://photogradient.com/), originally made by Daniel. The editor uses plain HTML, CSS, and JavaScript, with no build step or external dependencies.

Import or drop a photo to sample six colors. Edit, shuffle, add, or remove colors, then adjust the gradient style, warp, and noise. Hover over the canvas to drag the color points, or focus them with Tab and move them with the arrow keys. On touchscreens, the points are visible by default. Set the output dimensions and download the result as a PNG. Image processing and rendering take place in the browser.

To run locally, open `index.html`. The repository root can be published directly on GitHub Pages.

The Animate panel moves color points with orbit, drift, or wave motion. Travel and overlap control the motion, with optional hue cycling and warp pulsing. Export 3-, 5-, or 8-second loops as GIF, or MP4 in browsers with MP4 MediaRecorder support. Animation exports use their own longest-side resolution (320, 480, or 640 pixels). GIF encoding uses the bundled MIT-licensed gifenc library. GIF uses 15 frames per second and 256 colors per frame. MP4 records in real time and frame rate depends on rendering speed.
