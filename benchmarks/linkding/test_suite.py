import copy
import unittest

from suite import validate_state


class CaseValidationTests(unittest.TestCase):
    def test_tags_cross_owner_and_control_are_distinct_outcomes(self):
        before = {
            "bookmarks": [
                {"id": 2, "owner_id": 1, "is_archived": False, "unread": False, "date_modified": "a"},
                {"id": 7, "owner_id": 2, "is_archived": False, "unread": False, "date_modified": "a"},
            ],
            "tags": [{"id": 1}],
            "bookmark_tags": [{"bookmark_id": 2, "tag_id": 1}],
        }
        clean = copy.deepcopy(before)
        clean["bookmarks"][0].update(is_archived=True, date_modified="b")
        validate_state(before, clean, 2, "archive_refresh_control")
        for case_id in ("archive_clears_tags", "archive_changes_other_owner", "archive_deletes_bookmark"):
            with self.assertRaises(RuntimeError):
                validate_state(before, clean, 2, case_id)
        tags = copy.deepcopy(clean)
        tags["bookmark_tags"] = []
        validate_state(before, tags, 2, "archive_clears_tags")
        with self.assertRaises(RuntimeError):
            validate_state(before, tags, 2, "clean_archive")
        other = copy.deepcopy(clean)
        other["bookmarks"][1]["unread"] = True
        validate_state(before, other, 2, "archive_changes_other_owner")
        with self.assertRaises(RuntimeError):
            validate_state(before, other, 2, "archive_toggles_unread")

    def test_count_preserving_unread_defect_requires_exact_change(self):
        before = {
            "bookmarks": [
                {"id": 2, "owner_id": 1, "is_archived": False, "unread": False, "date_modified": "a"},
                {"id": 7, "owner_id": 2, "is_archived": False, "unread": False, "date_modified": "a"},
            ],
            "tags": [{"id": 1}],
            "bookmark_tags": [{"bookmark_id": 2, "tag_id": 1}],
        }
        after = copy.deepcopy(before)
        after["bookmarks"][0].update(is_archived=True, unread=True, date_modified="b")
        validate_state(before, after, 2, "archive_toggles_unread")
        with self.assertRaises(RuntimeError):
            validate_state(before, after, 2, "archive_refresh_control")
        after["bookmarks"][1]["unread"] = True
        with self.assertRaises(RuntimeError):
            validate_state(before, after, 2, "archive_toggles_unread")


if __name__ == "__main__":
    unittest.main()
