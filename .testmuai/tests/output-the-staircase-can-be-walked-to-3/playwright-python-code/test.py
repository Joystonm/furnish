import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="7841f4a8-b1b1-4466-a5c1-e39026e646d9",
    name="Verify Staircase Door and Usability",
    tc_id="TC-34",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"staircase_door_drawn_check": "true", "staircase_finding": "Nothing found", "floor_2_staircase_drawn_check": "true", "staircase_door_status": "true", "stair_usability": "true", "staircase_storeys_status": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='89bda69f-9594-431e-bf8f-365a961adc72'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Clicking the Ground floor tab to locate the staircase in the drawing', instruction_id='265910fb-1bb2-458e-8447-d2ffef93eba4'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-0\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('whether a door drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc is present (in the ground-floor stair well)', instruction_id='b89904cf-9b46-4de8-999e-9d1fa1475ccb'):
        set_var('staircase_door_drawn_check', await testmu.vision_query(page, "whether a door drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc is present (in the ground-floor stair well)", ""))
    
    async with testmu.step('Assertion check', instruction_id='02cb6944-fc54-4fa0-8633-c9f3f8d9d04d'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'store_key': 'staircase_door_drawn_check', 'variable_refs': {'{{staircase_door_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'store_key': 'staircase_door_drawn_check', 'expected_value': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc'})
    
    async with testmu.step('Reviewing the findings panel for staircase notes in the right sidebar', instruction_id='c643df4e-4d7f-490c-963b-bb3204f9f904'):
        await page.wait_for_timeout(500)
    
    async with testmu.step('Reading the staircase finding from the Findings panel'):
        set_var('staircase_finding', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {91: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (Array.from(el(91).querySelectorAll('*')).find(e => e.children.length === 0 && e.textContent.trim() === 'Nothing found')?.textContent.trim() ?? null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:role=complementary >> internal:has-text="FindingsLedgerNothing"i'], query='the finding about the staircase in the Findings panel', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='any finding about the staircase from the findings panel on the right is saved as {{staircase_finding}}'))
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='25c9c8fe-ed9c-4db2-a5a7-a881b0294f11'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('Checking whether the arriving staircase flight is drawn on Floor 2'):
        set_var('floor_2_staircase_drawn_check', await testmu.textual_analyzer(page, wrapped_js='(els) => {\n  const __m = {82: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(82).querySelector(\'g[data-testid="plan-stair-arriving"]\') !== null);\n  return (typeof __v === \'boolean\' ? String(__v) : __v);\n}', locators=['internal:testid=[data-testid="plan-svg"s]'], query='whether the staircase drawn on Floor 2 as the flight arriving at that level is present (in the Floor 2 floor plan)', expected_value='true', needs_unit_conversion=False, operator='equals', transforms=[], condition='the staircase is drawn there too, as the flight arriving at that level'))
    
    async with testmu.step('Assertion check', instruction_id='68f03ebb-9875-41ca-a3ef-182d9840e18f'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the staircase is drawn there too, as the flight arriving at that level', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{floor_2_staircase_drawn_check}}', 'store_key': 'floor_2_staircase_drawn_check', 'variable_refs': {'{{floor_2_staircase_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'the staircase is drawn there too, as the flight arriving at that level', 'store_key': 'floor_2_staircase_drawn_check', 'expected_value': 'true', 'extracted_value': '{{floor_2_staircase_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the staircase is drawn there too, as the flight arriving at that level'})
    
    async with testmu.step('Reviewing the staircase door and checking if it is usable across floors', instruction_id='d8bbfaf0-040b-4e2b-877c-577d8ce32979'):
        await page.wait_for_timeout(500)
    
    async with testmu.step('whether the staircase has a door into it from the drawing is saved as {{staircase_door_status}}', instruction_id='7377dafb-1ba5-47ff-8eb7-4c1d78514df1'):
        set_var('staircase_door_status', await testmu.vision_query(page, "whether the staircase has a door into it from the drawing is saved as {{staircase_door_status}}", ""))
    
    async with testmu.step('whether the stair is usable from the drawing and findings panel is saved as {{stair_usability}}', instruction_id='03ac7c82-56d7-4c44-a95f-77162ae9ee86'):
        set_var('stair_usability', await testmu.vision_query(page, "whether the stair is usable from the drawing and findings panel is saved as {{stair_usability}}", ""))
    
    async with testmu.step('whether the staircase is drawn on both storeys from the Ground floor and Floor 2 drawings is saved as {{staircase_storeys_status}}', instruction_id='6f66e686-e05a-4698-acd3-13a093863487'):
        set_var('staircase_storeys_status', await testmu.vision_query(page, "whether the staircase is drawn on both storeys from the Ground floor and Floor 2 drawings is saved as {{staircase_storeys_status}}", ""))


if __name__ == "__main__":
    testmu.run(test)