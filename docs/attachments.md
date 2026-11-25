# File attachments

Any file can be attached to a note. It is stored **next to the note** (same
folder), so it syncs with the notebook like images do, and the note links to it
with an ordinary Markdown link, so other Markdown tools show a working link:

```markdown
[📎 Itinerary.pdf](Itinerary.pdf)
```

## What makes a link an attachment

A paragraph that consists of exactly one link whose text starts with `📎`
(optionally followed by a space) and whose target is a relative path (not a URL
with a scheme, not a `.md` note) is shown as an attachment **card**. The link
text after `📎 ` is the name shown; the target is the file, relative to the
note's folder, URL-encoded (`My%20file.pdf`). Links anywhere else stay links.

## Adding one

- Web: `/` › *File…*, or the toolbar's **+** › *File…*.
- Desktop: `/` › *File…*, *Insert › File…*.

The file keeps its name. If that name is taken in the folder, a number is added
before the extension: `Report (2).pdf`, `Report (3).pdf`, …

## The card

Icon by file type, the name, the size when known, and:

- a click opens the file's page on Google Drive (preview, download, share),
  `https://drive.google.com/file/d/<id>/view`;
- a download button: `https://drive.google.com/uc?export=download&id=<id>`;
- on the desktop, *Open* opens the local copy (and *Show in Google Drive* is
  available when the notebook syncs to Google Drive).

A file that is not on Drive (yet) shows as such, without the Drive links.

## Encrypted notebooks

Attachments, like images, are **not encrypted**: both apps ask before attaching
a file to a note in an encrypted notebook.
