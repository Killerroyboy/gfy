# Invite + nudge copy (for the Gmail drafts)

Paste each block into its own normal Gmail draft in goodfriendsyearly@gmail.com.
`{first}`, `{rsvp_button}` and `{rsvp}` are filled per person by `tools/gfy-mailer.gs`. Every
`[FILL: ...]` must be replaced by hand: the sender BLOCKS while any `[FILL` is left
in the subject or body. Do not add inline images (the sender blocks those too).

Only these seven things are left to fill: 2027 dates, course, lodging, format,
deposit amount, payment handle, sign-off name.

**Never make the button a link yourself.** Gmail rewrites a link typed into a draft:
`href="{rsvp}"` becomes `href="javascript:void(0);"`, the button colours are stripped, and URLs are
wrapped as `https://www.google.com/url?q=...`. So type the text token `{rsvp_button}` on its own line
(plain text, no link, no formatting): the sender replaces it with a full pine/bone styled button for
each person. `{rsvp}` typed as plain text becomes the person's URL (shown as a link in the HTML,
plain in the text version). The sender BLOCKS if the draft still contains a `javascript:` link or a
`%7B...%7D` link, and unwraps any `google.com/url?q=` wrapper back to the real URL.

---

## 1. Invite draft

**Subject (exact, including the prefix):**

    [GFY TEMPLATE] Good Friends Yearly 2027 — are you in, {first}?

**Body (HTML-ready):**

```html
<p>{first},</p>

<p>Good Friends Yearly is back. <b>[FILL: 2027 dates]</b> at <b>[FILL: course]</b>.</p>

<p>
Lodging: [FILL: lodging]<br>
Format: [FILL: format]<br>
Deposit: [FILL: deposit amount], to [FILL: payment handle]
</p>

<p>One tap, no login:</p>

<p>{rsvp_button}</p>

<p>If the button does not work, paste this into your browser: {rsvp}</p>

<p>Answering IN holds your spot. The deposit is what locks it.</p>

<p>[FILL: sign-off name]</p>
```

**Plain-text version (Gmail builds it from the HTML; this is what it should read like):**

```
{first},

Good Friends Yearly is back. [FILL: 2027 dates] at [FILL: course].

Lodging: [FILL: lodging]
Format: [FILL: format]
Deposit: [FILL: deposit amount], to [FILL: payment handle]

One tap, no login: {rsvp}
IN, OUT or MAYBE.

Answering IN holds your spot. The deposit is what locks it.

[FILL: sign-off name]
```

---

## 2. Nudge draft

Sent as a FRESH email to the person's invite address with the subject `Re: <their original invite subject>`
(Gmail usually threads it), so only the **body** matters - the draft's own subject is only the `[GFY NUDGE]`
marker the sender finds it by.

**Subject (exact):**

    [GFY NUDGE] Still in, {first}?

**Body (HTML-ready):**

```html
<p>{first}, quick one: still waiting on your answer for [FILL: 2027 dates].</p>

<p>{rsvp_button}</p>

<p>Same link as before, or paste: {rsvp}</p>

<p>MAYBE is fine. Silence is the only wrong answer.</p>

<p>[FILL: sign-off name]</p>
```

---

## Checklist before the first live send

1. Replace every `[FILL: ...]`.
2. Exactly ONE draft starts `[GFY TEMPLATE]` and at most ONE starts `[GFY NUDGE]`.
3. Script property `WEBAPP_URL` set (the Web App `/exec` URL, deployed from the CURRENT code: Manage deployments -> Edit -> New version); `RSVP` tab exists (run Polish admin sheet).
4. Check the Dashboard line "template draft: OK - ...".
5. Send in TEST MODE first: every message goes to goodfriendsyearly@ with a `[TEST -> address]` subject.
