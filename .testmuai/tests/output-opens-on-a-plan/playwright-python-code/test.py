import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="fe3a9178-b117-4e2b-92f2-b21d99fa0cfc",
    name="Verify Floor Plan Drawing Elements",
    tc_id="TC-27",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"drawing_not_empty_check": "true", "dashed_plot_boundary_check": "true", "building_inside_plot_boundary_check": "true", "three_rooms_with_walls_check": "true", "north_point_marked_n_check": "true", "scale_bar_marked_0_and_2_m_check": "true", "staircase_parallel_tread_lines_check": "true", "staircase_rise_arrow_check": "true", "door_quarter_circle_swing_arc_check": "true", "door_straight_leaf_line_check": "true", "every_room_name_check": "true", "every_room_area_square_metres_check": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='a0f5a0ce-5b12-4345-ba10-307b8baa57a9'):
        await page.goto("http://localhost:5199")
    _condition_met = False
    _until_retries = 0
    while _until_retries < 10:
        print(f"[until-loop] iteration {_until_retries + 1}/10")
        async with testmu.step('Waiting for the page to settle and reading the drawing in the center', instruction_id='187d31be-9a3a-4080-b60f-cd3a7efe463b'):
            await page.wait_for_timeout(1000)
        await page.wait_for_timeout(500)
        if await testmu.check_until_condition(page, 'the ground floor drawing is visible in the middle panel'):
            _condition_met = True
            break
        _until_retries += 1
    set_var("__result__", {"condition_met": _condition_met, "retries": _until_retries + 1})
    
    async with testmu.step('whether the drawing content is present (in the displayed ground floor plan)', instruction_id='357c2f95-af0e-442e-b7f0-cb9e0ca6ffaf'):
        set_var('drawing_not_empty_check', await testmu.vision_query(page, "whether the drawing content is present (in the displayed ground floor plan)", ""))
    
    async with testmu.step('whether the plot boundary as a dashed line is present (around the displayed floor plan)', instruction_id='25c4dd83-1bed-4800-a4f3-1ba0c990bbcd'):
        set_var('dashed_plot_boundary_check', await testmu.vision_query(page, "whether the plot boundary as a dashed line is present (around the displayed floor plan)", ""))
    
    async with testmu.step('whether the building inside the plot boundary is present (within the displayed plot boundary)', instruction_id='f2d68d4f-72f5-456e-b3e0-0dafdcdbc307'):
        set_var('building_inside_plot_boundary_check', await testmu.vision_query(page, "whether the building inside the plot boundary is present (within the displayed plot boundary)", ""))
    
    async with testmu.step('whether at least three distinct rooms separated by walls are shown', instruction_id='26f137b7-a6d3-4a6d-bfa2-77b0878ba551'):
        set_var('three_rooms_with_walls_check', await testmu.vision_query(page, "whether at least three distinct rooms separated by walls are shown", ""))
    
    async with testmu.step('whether a north point marked N is present (at the upper right of the displayed plan)', instruction_id='9eb467b5-27c4-4a38-b6c4-3879f2ab7238'):
        set_var('north_point_marked_n_check', await testmu.vision_query(page, "whether a north point marked N is present (at the upper right of the displayed plan)", ""))
    
    async with testmu.step('whether a scale bar marked 0 and 2 m is present (at the lower left of the displayed plan)', instruction_id='7178a66b-3a02-406c-a5ea-bdf527b58c84'):
        set_var('scale_bar_marked_0_and_2_m_check', await testmu.vision_query(page, "whether a scale bar marked 0 and 2 m is present (at the lower left of the displayed plan)", ""))
    
    async with testmu.step('whether a staircase flight drawn with a series of parallel tread lines is present (on the right side of the ground floor drawing)', instruction_id='2f1f7b70-9fad-41f4-b9fb-e2a4b8c651bc'):
        set_var('staircase_parallel_tread_lines_check', await testmu.vision_query(page, "whether a staircase flight drawn with a series of parallel tread lines is present (on the right side of the ground floor drawing)", ""))
    
    async with testmu.step('whether a staircase arrow showing which way it rises is present (within the staircase on the right side of the ground floor drawing)', instruction_id='83e46a3b-340c-4192-b9e3-f3944bf08ceb'):
        set_var('staircase_rise_arrow_check', await testmu.vision_query(page, "whether a staircase arrow showing which way it rises is present (within the staircase on the right side of the ground floor drawing)", ""))
    
    async with testmu.step('whether at least one door with a quarter-circle swing arc is present (at door openings in the displayed floor plan)', instruction_id='cd479936-a3ce-4dd0-9db1-0e02dd5f229d'):
        set_var('door_quarter_circle_swing_arc_check', await testmu.vision_query(page, "whether at least one door with a quarter-circle swing arc is present (at door openings in the displayed floor plan)", ""))
    
    async with testmu.step('whether at least one door with a straight leaf line is present (at door openings in the displayed floor plan)', instruction_id='db6ba4d4-c14f-4975-b845-89fbf481f6fb'):
        set_var('door_straight_leaf_line_check', await testmu.vision_query(page, "whether at least one door with a straight leaf line is present (at door openings in the displayed floor plan)", ""))
    
    async with testmu.step('whether a name on every room on the drawing is present (inside rooms across the displayed drawing)', instruction_id='2a08be8e-497d-4b53-98ea-08ec040203b2'):
        set_var('every_room_name_check', await testmu.vision_query(page, "whether a name on every room on the drawing is present (inside rooms across the displayed drawing)", ""))
    
    async with testmu.step('whether an area in square metres on every room on the drawing is present (inside rooms across the displayed drawing)', instruction_id='ab8079bc-867d-44b8-96ea-74e3476065e8'):
        set_var('every_room_area_square_metres_check', await testmu.vision_query(page, "whether an area in square metres on every room on the drawing is present (inside rooms across the displayed drawing)", ""))
    
    async with testmu.step('Assertion check', instruction_id='56fd61b1-854e-4d74-8d35-707da15ae20d'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the drawing is not empty', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{drawing_not_empty_check}}', 'store_key': 'drawing_not_empty_check', 'variable_refs': {'{{drawing_not_empty_check}}': 'true'}}, {'description': 'the plot boundary is shown as a dashed line', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{dashed_plot_boundary_check}}', 'store_key': 'dashed_plot_boundary_check', 'variable_refs': {'{{dashed_plot_boundary_check}}': 'true'}}, {'description': 'the building is shown inside the plot boundary', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{building_inside_plot_boundary_check}}', 'store_key': 'building_inside_plot_boundary_check', 'variable_refs': {'{{building_inside_plot_boundary_check}}': 'true'}}, {'description': 'at least three rooms with walls between them are shown', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{three_rooms_with_walls_check}}', 'store_key': 'three_rooms_with_walls_check', 'variable_refs': {'{{three_rooms_with_walls_check}}': 'true'}}], 'sub_checks': [{'description': 'the drawing is not empty', 'store_key': 'drawing_not_empty_check', 'expected_value': 'true', 'extracted_value': '{{drawing_not_empty_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the plot boundary is shown as a dashed line', 'store_key': 'dashed_plot_boundary_check', 'expected_value': 'true', 'extracted_value': '{{dashed_plot_boundary_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the building is shown inside the plot boundary', 'store_key': 'building_inside_plot_boundary_check', 'expected_value': 'true', 'extracted_value': '{{building_inside_plot_boundary_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'at least three rooms with walls between them are shown', 'store_key': 'three_rooms_with_walls_check', 'expected_value': 'true', 'extracted_value': '{{three_rooms_with_walls_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the drawing is not empty and shows the plot boundary as a dashed line, the building inside it, and at least three rooms with walls between them'})
    
    async with testmu.step('Assertion check', instruction_id='7d7a391a-a655-4581-9829-66b9f5e1985f'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the drawing contains a north point marked N', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{north_point_marked_n_check}}', 'store_key': 'north_point_marked_n_check', 'variable_refs': {'{{north_point_marked_n_check}}': 'true'}}, {'description': 'the drawing contains a scale bar marked 0 and 2 m', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{scale_bar_marked_0_and_2_m_check}}', 'store_key': 'scale_bar_marked_0_and_2_m_check', 'variable_refs': {'{{scale_bar_marked_0_and_2_m_check}}': 'true'}}], 'sub_checks': [{'description': 'the drawing contains a north point marked N', 'store_key': 'north_point_marked_n_check', 'expected_value': 'true', 'extracted_value': '{{north_point_marked_n_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the drawing contains a scale bar marked 0 and 2 m', 'store_key': 'scale_bar_marked_0_and_2_m_check', 'expected_value': 'true', 'extracted_value': '{{scale_bar_marked_0_and_2_m_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the drawing contains a north point, marked N, and a scale bar marked 0 and 2 m'})
    
    async with testmu.step('Assertion check', instruction_id='e9d0b84a-94ed-42fe-9fc2-1d5d1fb49019'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the ground floor drawing contains a staircase flight drawn with a series of parallel tread lines', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_parallel_tread_lines_check}}', 'store_key': 'staircase_parallel_tread_lines_check', 'variable_refs': {'{{staircase_parallel_tread_lines_check}}': 'true'}}, {'description': 'the ground floor drawing contains a staircase arrow showing which way it rises', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_rise_arrow_check}}', 'store_key': 'staircase_rise_arrow_check', 'variable_refs': {'{{staircase_rise_arrow_check}}': 'true'}}], 'sub_checks': [{'description': 'the ground floor drawing contains a staircase flight drawn with a series of parallel tread lines', 'store_key': 'staircase_parallel_tread_lines_check', 'expected_value': 'true', 'extracted_value': '{{staircase_parallel_tread_lines_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the ground floor drawing contains a staircase arrow showing which way it rises', 'store_key': 'staircase_rise_arrow_check', 'expected_value': 'true', 'extracted_value': '{{staircase_rise_arrow_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the ground floor drawing contains a staircase: a flight drawn with a series of parallel tread lines and an arrow showing which way it rises'})
    
    async with testmu.step('Assertion check', instruction_id='268a4067-7d90-40ba-a358-5c528df37a15'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'at least one door is drawn with a quarter-circle swing arc', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{door_quarter_circle_swing_arc_check}}', 'store_key': 'door_quarter_circle_swing_arc_check', 'variable_refs': {'{{door_quarter_circle_swing_arc_check}}': 'true'}}, {'description': 'at least one door is drawn with a straight leaf line', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{door_straight_leaf_line_check}}', 'store_key': 'door_straight_leaf_line_check', 'variable_refs': {'{{door_straight_leaf_line_check}}': 'true'}}], 'sub_checks': [{'description': 'at least one door is drawn with a quarter-circle swing arc', 'store_key': 'door_quarter_circle_swing_arc_check', 'expected_value': 'true', 'extracted_value': '{{door_quarter_circle_swing_arc_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'at least one door is drawn with a straight leaf line', 'store_key': 'door_straight_leaf_line_check', 'expected_value': 'true', 'extracted_value': '{{door_straight_leaf_line_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'at least one door is drawn with a quarter-circle swing arc and a straight leaf line'})
    
    async with testmu.step('Assertion check', instruction_id='05518907-2f38-4986-b487-c724a73954dc'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'every room on the drawing carries a name', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{every_room_name_check}}', 'store_key': 'every_room_name_check', 'variable_refs': {'{{every_room_name_check}}': 'true'}}, {'description': 'every room on the drawing carries an area in square metres', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{every_room_area_square_metres_check}}', 'store_key': 'every_room_area_square_metres_check', 'variable_refs': {'{{every_room_area_square_metres_check}}': 'true'}}], 'sub_checks': [{'description': 'every room on the drawing carries a name', 'store_key': 'every_room_name_check', 'expected_value': 'true', 'extracted_value': '{{every_room_name_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'every room on the drawing carries an area in square metres', 'store_key': 'every_room_area_square_metres_check', 'expected_value': 'true', 'extracted_value': '{{every_room_area_square_metres_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'every room on the drawing carries a name and an area in square metres'})
    
    async with testmu.step('Waiting while reviewing which assertions held and which did not', instruction_id='a5cc209f-ea8d-4036-8e0f-e4996c748d3f'):
        await page.wait_for_timeout(100)


if __name__ == "__main__":
    testmu.run(test)