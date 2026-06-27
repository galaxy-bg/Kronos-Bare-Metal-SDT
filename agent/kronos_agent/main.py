from __future__ import annotations


def main() -> None:
    # Compatibility note: the current ISO still executes agent/kdx-agent.py.
    # This package is the target modular layout for the next agent refactor.
    raise SystemExit("Use agent/kdx-agent.py until the modular agent entry point is wired.")


if __name__ == "__main__":
    main()
