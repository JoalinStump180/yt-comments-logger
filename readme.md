# Visit URL Logger — Concise User Guide

**Purpose:** Record browsing history, organize YouTube visits, extract YouTube comments and uploader posts, and search, review, export, or import the collected data.

## 1. Install and open

1. Open `edge://extensions` in Microsoft Edge, or `chrome://extensions` in Chrome.
    
2. Enable **Developer mode**.
    
3. Choose **Load unpacked** and select the extracted extension folder.
    
4. Click the extension icon to open its popup. Select **Open explorer** to manage stored records.
    

## 2. Main capabilities

### A. Automatic visit logging

- Records main-frame page navigations and associated titles.
    
- Canonicalizes YouTube watch URLs by removing the playback-time parameter (`t=`).
    
- Adds a date marker when needed, so visits to the same video on different days can be recorded separately.
    
- Avoids inserting an already-recorded canonical URL again.
    
- Offers configurable title-update behavior when a URL already exists.
    

### B. YouTube comment and uploader-post extraction

- Extracts text according to configurable rules for YouTube comments and Community posts.
    
- Identifies ordinary comments using a parent/video ID and comment ID.
    
- Identifies uploader posts using a post ID, without requiring a comment link.
    
- Stores extracted text and associated information such as author, source URL, and item UID.
    
- Can display extraction results in a draggable, transparent real-time window.
    

### C. Real-time extraction window

The window can show:

- **NEW** — an item not previously recognized.
    
- **ALREADY** — an item whose identity has already been recorded.
    
- Text previews, source URLs, and UIDs.
    
- A bounded activity log and configurable display colors.
    

Use **Show realtime comments transparent window** in the extension popup to control the window. **Log extracted items** controls whether newly detected rule-based items are saved; the window can still identify existing items when saving is disabled.

### D. Explorer and search

Explorer provides:

- **All records**, **YouTube URLs**, **Other URLs**, **Recycle box**, and **Diagnostic** views.
    
- Search across dates, titles, URLs, and optionally extracted comments.
    
- Search-scope checkboxes for date/time, URL, and title.
    
- A preview of comments associated with a selected history row.
    
- Options to expand comments when a URL or comment matches a search.
    
- **Comment ID once (first row)** to show an identified item in its first matching history row rather than repeating it across rows.
    
- **Same title once each day** to reduce repeated rows with matching titles on the same date.
    

### E. Record management and data transfer

- **New** — manually add a history record.
    
- **Delete** — delete a selected record.
    
- **Export** / **Import History** — back up or restore browsing-history records using JSON.
    
- **Export Comments** / **Import Comments** — transfer extracted comments and their associated video information.
    

### F. Configuration and diagnostics

- Right-click **All records** and choose **Config…** to edit the text-extraction rules.
    
- Rule changes are shared with the extraction window and applied to open YouTube tabs.
    
- Use **Diagnostic** to inspect items that could not be assigned a reliable identity.
    
- Its **Log diagnostic items** setting controls whether new diagnostic entries are recorded; disabling it does not delete existing entries.
    

## 3. Important settings

|Setting|What it controls|
|---|---|
|**Comments logging**|Whether extracted comments are persisted by the extension's comment-logging path.|
|**Show realtime comments transparent window**|Whether the live extraction window is displayed.|
|**Log extracted items**|Whether newly detected rule-based extraction items are saved.|
|**Comment ID once (first row)**|Whether repeated appearances of the same item are restricted to its first matching history row.|
|**Same title once each day**|Whether repeated same-title history rows on one date are reduced in the Explorer display.|

**Note:** Comments logging and the real-time window are separate controls. Turning off one does not necessarily turn off the other.

## 4. Practical workflow

1. Install the extension and browse normally to collect visit history.
    
2. Enable **Comments logging** if you want the comment-logging path to save extracted comments.
    
3. Open a YouTube page and check the real-time window for **NEW** and **ALREADY** results.
    
4. Open Explorer, search for a video title or comment text, and select a row to inspect its associated comments.
    
5. Check **Comment ID once (first row)** if repeated comment/post entries make the results difficult to read.
    
6. Export history and comments periodically if you need separate backups.
    

## 5. Known considerations

- Extraction depends on the page's available DOM structure, links, and identifiers; some items may not have enough information to identify reliably.
    
- Check **Diagnostic** when expected items are missing.
    
- Imported records may not contain every field available in newly collected records.
    
- The included Tampermonkey hash-tab tester is a separate script with its own IndexedDB; do not assume its data is automatically shared with the extension.