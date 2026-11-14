import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="ec9fa2aa-96d3-454a-bf6a-365af24a8914",
    name="Validate Plot Fit Refusal and Plan Generation",
    tc_id="TC-36",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"program_fits_plot_check": "false", "refusal_red_box_shown": "true", "refusal_area_detail_line_shown": "true", "nonfitting_rooms_drawing_absent": "false", "drawing_returned": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='86769311-b920-4827-b0ef-9efbdf93363e'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('whether the program fits the plot is present (in the visible plan findings and plot layout)', instruction_id='7ea7585b-994f-4d42-9c68-dc362c1f493c'):
        set_var('program_fits_plot_check', await testmu.vision_query(page, "whether the program fits the plot is present (in the visible plan findings and plot layout)", ""))
    if await testmu.evaluate_branch(sub_checks=[{'description': 'the program cannot fit the plot', 'store_key': 'program_fits_plot_check', 'expected_value': 'false', 'stored_value': '{{program_fits_plot_check}}', 'operator': 'equals', 'transforms': []}], composite_operator="and"):
        async with testmu.step('Waiting for the plan to be generated', instruction_id='52d1ceaa-d0e1-45e6-80a6-6b49537fc0a7'):
            await page.wait_for_timeout(1000)
        
        async with testmu.step('Type "6" into "Plot width in metres"', instruction_id='8c5cb700-067a-4b6f-a3dc-76480a5035cd'):
            element_0 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
            
            await testmu.fill(element_0, "6")
        
        async with testmu.step('Type "5" into "Plot depth in metres"', instruction_id='2cb4bb23-2260-44f3-9c97-dd82d86c38a5'):
            element_1 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
            
            await testmu.fill(element_1, "5")
        
        async with testmu.step('Click "Generate the plan"', instruction_id='c2ba8161-1bed-4e02-944f-7b852d7160d3'):
            _loc_1 = page.locator("internal:testid=[data-testid=\"generate\"s]")
            
            await _loc_1.click()
    
    async with testmu.step('Waiting for the current plot width and depth to be shown in the brief panel', instruction_id='cee1bf9b-ecb7-4654-9c58-fdf155f2b051'):
        await page.wait_for_timeout(100)
    
    async with testmu.step('Waiting for the plot dimensions inputs to update', instruction_id='9684bf95-0f08-443d-b59b-36fa2e9f292e'):
        await page.wait_for_timeout(100)
    
    async with testmu.step('Waiting for the plan to generate', instruction_id='b0508152-581e-46aa-84df-1495b2007da5'):
        await page.wait_for_timeout(100)
    
    async with testmu.step('whether a red box saying the program does not fit the plot is present (in the left brief panel)', instruction_id='0d90746a-0bc1-4823-8f9c-024d7a5b0657'):
        set_var('refusal_red_box_shown', await testmu.vision_query(page, "whether a red box saying the program does not fit the plot is present (in the left brief panel)", ""))
    
    async with testmu.step('whether a detail line giving the area asked for and the area the plot holds is present (in the red refusal box in the left brief panel)', instruction_id='2f9f22a8-1b0c-4cd3-a8b9-48ed4fc0b547'):
        set_var('refusal_area_detail_line_shown', await testmu.vision_query(page, "whether a detail line giving the area asked for and the area the plot holds is present (in the red refusal box in the left brief panel)", ""))
    
    async with testmu.step('whether a drawing of rooms that do not fit in the middle canvas is present (in the middle canvas)', instruction_id='9b5fa91d-2421-43db-84cd-a3c22f6ee80e'):
        set_var('nonfitting_rooms_drawing_absent', await testmu.vision_query(page, "whether a drawing of rooms that do not fit in the middle canvas is present (in the middle canvas)", ""))
    
    async with testmu.step('Assertion check', instruction_id='482491e2-779e-44d4-9e02-07323d04827c'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A red box saying the program does not fit the plot is shown.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{refusal_red_box_shown}}', 'store_key': 'refusal_red_box_shown', 'variable_refs': {'{{refusal_red_box_shown}}': 'true'}}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{refusal_area_detail_line_shown}}', 'store_key': 'refusal_area_detail_line_shown', 'variable_refs': {'{{refusal_area_detail_line_shown}}': 'true'}}], 'sub_checks': [{'description': 'A red box saying the program does not fit the plot is shown.', 'store_key': 'refusal_red_box_shown', 'expected_value': 'true', 'extracted_value': '{{refusal_red_box_shown}}', 'operator': 'equals', 'transforms': []}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'store_key': 'refusal_area_detail_line_shown', 'expected_value': 'true', 'extracted_value': '{{refusal_area_detail_line_shown}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A refusal is shown: a red box saying the program does not fit the plot, with a detail line that gives the area asked for and the area the plot holds.'})
    
    async with testmu.step('Assertion check', instruction_id='dfd293ac-3fa4-4c11-8fe0-b49efbec8dce'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{nonfitting_rooms_drawing_absent}}', 'store_key': 'nonfitting_rooms_drawing_absent', 'variable_refs': {'{{nonfitting_rooms_drawing_absent}}': 'false'}}], 'sub_checks': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'store_key': 'nonfitting_rooms_drawing_absent', 'expected_value': 'false', 'extracted_value': '{{nonfitting_rooms_drawing_absent}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.'})
    
    async with testmu.step('Waiting for the queued plan to finish', instruction_id='3f583b17-1638-4722-8fbe-b55c8f4856bb'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "18" into "Plot width in metres"', instruction_id='ec2663d4-b630-427d-8f29-f8cfae7f6cfb'):
        element_2 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
        
        await testmu.fill(element_2, "18")
    
    async with testmu.step('Type "14" into "Plot depth in metres"', instruction_id='f11bbb87-43c8-4c95-9c60-36c1a7dfd9d5'):
        element_3 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
        
        await testmu.fill(element_3, "14")
    
    async with testmu.step('Click "Generate the plan"', instruction_id='47ed0db0-0976-42aa-9980-e75ac7bd3567'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"generate\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('Waiting for the plan to generate', instruction_id='8e652ceb-7b16-45ee-8133-e714cb20ef13'):
        await page.wait_for_timeout(100)
    
    async with testmu.step('whether a drawing is present (in the main plan canvas)', instruction_id='139bf2f9-6421-4272-b955-bbedff4f42b3'):
        set_var('drawing_returned', await testmu.vision_query(page, "whether a drawing is present (in the main plan canvas)", ""))
    
    async with testmu.step('Assertion check', instruction_id='b225044f-714a-4dc4-afd4-e56c5b30cd5f'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A drawing comes back.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{drawing_returned}}', 'store_key': 'drawing_returned', 'variable_refs': {'{{drawing_returned}}': 'true'}}], 'sub_checks': [{'description': 'A drawing comes back.', 'store_key': 'drawing_returned', 'expected_value': 'true', 'extracted_value': '{{drawing_returned}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A drawing comes back.'})


if __name__ == "__main__":
    testmu.run(test)