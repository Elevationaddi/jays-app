# ADR-0036: Image privacy with Sharp, and the ClamAV hosting review

Status: Accepted. Sharp image processing is built and tested locally; it has not run on Vercel yet. The scanner production blocker from ADR-0032 is **kept**.

Date: 2026-11-28

## Context

The founder's answers of 28 November 2026:

- **Question 6:** the open-source Sharp library is approved for secure image processing. It must remove EXIF and GPS metadata, re-encode safely, correct orientation, compress, limit resolution, validate format and size, and protect against malicious or malformed files. It must be tested for the Vercel runtime. Re-encoding never replaces the malware scan.
- **Question 2:** ClamAV is approved, but no paid server or scanning subscription. Review ADR-0032 and investigate whether a secure, reliable scanner can run on existing infrastructure at no recurring cost. Keep the production blocker if no option exists. Never bypass scanning.

ADR-0032 listed image re-encoding as not done, pending this approval. Until now, photos kept their location metadata.

## Decision

### 1. Every accepted image is re-encoded (`apps/api/src/storage/image-sanitizer.ts`)

Order of checks when an upload is completed (`verifyStoredUpload`):

1. The object exists and is within the size limit.
2. The real type, read from magic bytes, matches the declared type. Media images also get dimension and aspect rules (unchanged).
3. **Malware scan of the bytes exactly as uploaded** (unchanged, fails closed).
4. **New:** a JPEG, PNG or WebP is decoded and written again by Sharp:
   - **Metadata:** nothing is copied, so EXIF (including GPS location, camera and owner fields), XMP, IPTC, comments and ICC profiles are removed. Anything hidden after the image data (for example an appended archive) is not part of the decoded pixels, so it disappears.
   - **Orientation:** the EXIF orientation is applied to the pixels (`rotate()`), so photos stay upright without it.
   - **Colour:** converted to sRGB.
   - **Resolution:** the longest side is limited to the purpose's `maxSide` (4,000 to 6,000 pixels, ADR-0012), or 4,000 for attachments and document images. Small images are never enlarged.
   - **Compression:** JPEG quality 82 (mozjpeg), PNG level 9, WebP quality 80. The format stays the same, so object keys and content types do not change.
   - **Format validation:** the decoder's own format must match the declared type. Corrupt or truncated files fail to decode (`failOn: 'warning'`) and are refused as `FILE_TYPE_MISMATCH`.
   - **Decompression bombs:** a file whose header claims more than 40 megapixels is refused before its pixels are allocated (`limitInputPixels`).
   - **Animation:** only the first frame is kept.
   - **Size validation:** if the re-encoded copy were larger than the purpose's byte limit, it is refused.
5. The re-encoded copy **replaces** the original in storage. The original bytes are never served. Size, SHA-256 and dimensions are recorded from the clean copy.

This applies to product, storefront and portfolio images, support ticket attachments, and image verification documents (when uploads are enabled). PDFs are not re-encoded: they are scanned only.

**Serverless settings:** one image at a time (`sharp.concurrency(1)`) and no cache between requests (`sharp.cache(false)`). Images are at most 4 MB (ADR-0032), so memory stays far below the function's 1,024 MB.

### 2. Sharp is a pinned dependency of the API only

- `sharp@0.34.5` is a dependency of `@jays/api` only. It is open source (Apache-2.0) with LGPL libvips binaries, and costs nothing.
- It ships prebuilt binaries (`@img/sharp-linux-x64` and others), so its install script is not allowed to run (`pnpm-workspace.yaml`, `ignoredBuiltDependencies`).
- **Vercel compatibility:** Vercel's Node.js 22 runtime is Linux x64 with glibc 2.34. Sharp's prebuilt Linux binaries need glibc 2.26 or newer, and Vercel's file tracing recognises Sharp. Locally, on Linux x64 with glibc 2.39, all tests pass. **Not yet verified on Vercel:** the first staging deployment must upload a product image and check that it comes back without metadata. This is on the STAGING.md checklist.

### 3. Scanner: blocker kept after the hosting review

The full comparison is in [CLAMAV_HOSTING_REVIEW.md](../CLAMAV_HOSTING_REVIEW.md). In short:

- **Ruled out:** Vercel Functions, Vercel Sandbox, Supabase, GitHub Actions, and free VMs with 1 GB or less cannot run `clamd` reliably, or would break their terms.
- **Viable:** only existing hardware the business owns, or Oracle Cloud's Always Free tier. The second requires a card at sign-up, and its idle instances can be reclaimed. Both need the founder's decision, and neither has an SLA.
- **Therefore:** production still refuses to start without `MALWARE_SCANNER=clamav` (with TLS). Staging keeps document uploads off (ADR-0035). Product images on staging are scanned by the mock, then re-encoded.
- **Local testing:** a real `clamd` (ClamAV 1.5.4) was run in the development environment. It passed the real-provider test: a clean file was accepted and EICAR was detected over INSTREAM. Only a local test signature could be used, because that environment's network blocks ClamAV's signature CDN. `docker compose --profile scanner up -d clamav` runs the official image with the full databases on a developer machine.

## Consequences

- Photos uploaded by businesses and customers no longer carry their location or camera data, and image files can no longer smuggle extra content past the scan.
- Completing an image upload now does one more read, decode and write. This adds tens to a few hundred milliseconds for typical images.
- The stored image is not byte-identical to the upload. The recorded SHA-256 is of the stored copy.
- Merchant document uploads stay unavailable in production until a scanner host is chosen and approved.

## Tests

- **`image-sanitizer.test.ts` (7 tests):**
  - GPS and camera EXIF are removed and the orientation is applied (dimensions swap);
  - data appended after the image is not kept;
  - the longest side is limited and the aspect ratio is kept;
  - small images are not enlarged;
  - truncated and non-image input is refused;
  - a declared type that differs from the real format is refused;
  - a header claiming 400 megapixels is refused.
- **Existing integration tests** for media, document and attachment uploads run through the new step.
