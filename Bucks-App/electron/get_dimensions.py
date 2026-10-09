from PIL import Image
import numpy as np

img = Image.open('/Users/mikado/.gemini/antigravity-ide/brain/914879c3-8e51-4f08-93f9-9a219110ff01/screenshot.png')
pixels = np.array(img)
print("Image dimensions:", img.size)

# Calculate variance in color
if len(pixels.shape) == 3:
    print("Unique colors:", len(np.unique(pixels.reshape(-1, pixels.shape[2]), axis=0)))
    print("Mean RGB:", np.mean(pixels, axis=(0,1)))
