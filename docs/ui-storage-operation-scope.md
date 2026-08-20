# Storage operation scope

This note records the intended UI behaviour for Google Drive actions.

- Account-level **Prepare** actions may process all eligible active shows for the selected Drive account.
- Show-level **Repair** or **Use Drive** actions must target exactly one show.
- While a show-level Drive operation is running, only that show's controls should be busy/disabled. Other show cards must remain independent.
- The Worker single-show endpoint remains `/api/storage/google-drive/provision`; the bulk endpoint remains `/api/storage/google-drive/provision-active-shows`.
- Success messaging for a show-level action must name the show and target Drive account and state that no other show was changed.
