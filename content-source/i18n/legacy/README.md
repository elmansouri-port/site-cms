# Archived catalogues

`es.json` and `it.json` describe an **older application** — a portal with
checkout, login and offers pages that no longer exists. Their keys
(`nav.offers`, `checkout.*`, …) share nothing with the current site: not one of
the 342 keys appears in `fr.json`, `en.json` or `de.json`.

They are kept so the translated copy is not lost, and they are deliberately
outside `../` so the seed never imports them: doing so would fill the CMS with
342 dead keys and make every language read as 82% translated when it is
complete.

Spanish and Italian are still listed in the CMS as inactive languages. To add
one for real, translate the current catalogue rather than reviving these files.
