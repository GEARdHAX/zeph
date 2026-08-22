// Applies a react-easy-crop crop region + rotation to a source image via an
// offscreen Canvas, producing the final Blob that gets uploaded — this is
// what keeps the crop/rotate step entirely client-side (the server never
// sees the original file, only this already-final result).

const MAX_OUTPUT_DIMENSION = 2048; // matches backend's largest `sizes` variant — no point producing anything bigger
const JPEG_QUALITY = 0.85;

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new window.Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not decode this image.'));
  img.src = src;
});

// Cheap opacity probe: downscale onto a tiny canvas and check the alpha
// channel, rather than scanning the full-resolution crop region pixel by
// pixel — only PNG sources are ever checked (JPEG/WebP/GIF frames from
// react-easy-crop's canvas draw have no alpha channel worth preserving).
const hasTransparency = (image, cropPixels) => {
  const probeSize = 32;
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = probeSize;
  probeCanvas.height = probeSize;
  const ctx = probeCanvas.getContext('2d');
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    probeSize,
    probeSize,
  );
  const { data } = ctx.getImageData(0, 0, probeSize, probeSize);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
};

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('Could not process this image.'));
      return;
    }
    resolve(blob);
  }, type, quality);
});

/**
 * @param {string} imageSrc - object URL of the source file
 * @param {{x:number,y:number,width:number,height:number}} cropPixels - react-easy-crop's onCropComplete croppedAreaPixels
 * @param {number} rotationDeg - rotation in degrees (0/90/180/270)
 * @param {string} sourceMimeType - the original File's type, used to decide PNG-vs-JPEG output
 * @returns {Promise<Blob>}
 */
const getCroppedImageBlob = async (imageSrc, cropPixels, rotationDeg, sourceMimeType) => {
  if (!cropPixels) throw new Error('Nothing to crop.');

  const image = await loadImage(imageSrc);

  const rotationRad = (rotationDeg * Math.PI) / 180;
  const isSideways = rotationDeg % 180 !== 0;

  // Rotate onto an intermediate canvas sized to fit the rotated full image,
  // then crop the (rotation-aware) requested region out of it. react-easy-
  // crop already returns cropPixels in the ROTATED image's coordinate space,
  // so this two-step draw keeps rotation and crop correctly aligned.
  const rotatedWidth = isSideways ? image.height : image.width;
  const rotatedHeight = isSideways ? image.width : image.height;

  const rotateCanvas = document.createElement('canvas');
  rotateCanvas.width = rotatedWidth;
  rotateCanvas.height = rotatedHeight;
  const rotateCtx = rotateCanvas.getContext('2d');
  rotateCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  rotateCtx.rotate(rotationRad);
  rotateCtx.drawImage(image, -image.width / 2, -image.height / 2);

  // Never upscale: only shrink toward the cap, never grow past the actual
  // cropped region's own size.
  const scale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(cropPixels.width, cropPixels.height));
  const outputWidth = Math.round(cropPixels.width * scale);
  const outputHeight = Math.round(cropPixels.height * scale);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.drawImage(
    rotateCanvas,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  const preservePng = sourceMimeType === 'image/png' && hasTransparency(rotateCanvas, cropPixels);
  return preservePng
    ? canvasToBlob(outputCanvas, 'image/png')
    : canvasToBlob(outputCanvas, 'image/jpeg', JPEG_QUALITY);
};

export default getCroppedImageBlob;
