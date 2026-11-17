-- MCP server URLs that carry a key (?api_key=..., user:password@, a key as
-- a path segment) were stored in plain text. The url column now holds the
-- masked address shown to people; the full address is sealed (AES-256-GCM
-- v2, bound to the workspace) in url_sealed and only opened to call the
-- server. Rows without a secret in the address keep url_sealed null.

ALTER TABLE osirus.mcp_servers ADD COLUMN IF NOT EXISTS url_sealed text;
