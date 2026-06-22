"""Allow `python -m ticket_triage` as an alias for `python -m ticket_triage.cli`."""
from ticket_triage.cli import main

if __name__ == "__main__":
    main()
