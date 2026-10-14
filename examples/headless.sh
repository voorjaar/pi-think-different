#!/bin/sh
# Headless / CLI usage examples. Run from any directory.

# 1. Start a session with a paradigm already armed.
pi --think tot

# 2. Let the extension choose: heuristic per prompt, or a different paradigm every turn.
pi --think auto
pi --think random

# 3. One non-interactive run with a paradigm pinned, markers visible in the answer.
pi --mode json --think hats -p "Evaluate this offline cache proposal" \
	| jq -r 'select(.type == "message_end" and .message.role == "assistant")
		| .message.content[] | select(.type == "text") | .text'

# 4. Ask for the code-driven workflow (separate model calls, harness decides what survives)
#    instead of single-pass scaffolding.
pi --think first-principles -p "Use the think tool with mode \"run\" on this: should we migrate the queue to a durable log?"

# 5. Combine with Pi's own thinking level (off|minimal|low|medium|high|xhigh|max). This is a
#    different axis from this extension's intensity, which is set in config or with
#    `/think <paradigm> <light|standard|deep>` in the session.
pi --think debate --thinking high
