# Agents connect through a hosted MCP server, sign in with Dazbee's own OAuth, and work in a tab

This extends ADR-0017's public addresses and ADR-0012's sign-in for agents. The full rules are in the MCP server spec (#46).

An agent (Claude Code, Claude Desktop and others) designs in Dazbee through an MCP server that Dazbee hosts, `apps/mcp`, at `https://app.dazbee.com/mcp`. Caddy sends `/mcp`, `/oauth/*` and `/.well-known/oauth-*` on that host to it, and everything else to the web app as before, so the public hostnames stay two. `apps/mcp` holds no secret and no database: it calls the API on the private network with the agent's own token, and the API, Postgres and storage stay private.

The agent signs in with the OAuth 2.1 flow the MCP spec asks for, which the API runs: open client registration, authorization code with PKCE, and access and refresh tokens kept only as hashes. The person approves on a page of the web app, signed in through WorkOS as usual, and picks the workspace, the brands and whether the agent edits or only views: an **agent access**, never more than their membership allows, ended from Settings or with the membership. The API takes an agent's token only on the routes agents use, with the membership's role and brands capped by the access.

The agent works in an **agent tab**: the editor's core opened in Node inside `apps/mcp`, joined to the sync server as a member's tab is. Its steps are commands (ADR-0004), checked and ordered by the sync server (ADR-0015), seen by open tabs once stored, and undone only by the agent's own tab. Before an agent's first change to the design, and before an agent's first change after a person's edit, the sync server keeps a version of the design, so the person can restore it.

## Considered Options

- **A local stdio server, as FigCraft's**: rejected. FigCraft's server sits beside a desktop app; Dazbee's designs live on its server, a local process would need an install, the CanvasKit build and fonts on every machine, and a key pasted into it, while Claude Code, Claude Desktop and claude.ai all take a remote server with OAuth.
- **A hostname of its own (`mcp.dazbee.com`)**: rejected. It would split the resource and its sign-in across two origins for no gain.
- **WorkOS AuthKit as the agents' authorization server**: rejected for now. The API would have to check WorkOS's JWTs on every request (ADR-0012 rejected that), and Dazbee would still need its own page for the workspace, brands and access.
- **Personal API keys pasted into the agent**: rejected. Claude Desktop's and claude.ai's connectors take OAuth, and a pasted key ends up in config files and chats.
- **Writing the agent's changes from the API, outside a tab**: rejected by ADR-0004. No tab would see them as they happen, and no one could undo them in one step.
