"""A minimal connection check with no user documents or project data."""
import sys
from book_to_skill_bridge import response_json, STRING
try:
    response_json('Return the requested JSON.', 'Respond with a short greeting in the answer field.', {'answer': STRING}, 512)
    print('ok')
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)
