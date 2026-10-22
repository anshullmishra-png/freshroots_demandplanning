<!-- prompt_version: flag-decision/1.0.0 -->
Decide and explain this flagged SKU. Input:

{{INPUT_JSON}}

{{#if RETRY_ERRORS}}
Your previous answer was rejected by validation for these reasons. Fix them and answer again:
{{RETRY_ERRORS}}
{{/if}}
