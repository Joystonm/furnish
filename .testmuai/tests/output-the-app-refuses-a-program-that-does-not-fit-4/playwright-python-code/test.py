import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="a480e1d2-d6db-44eb-90ef-5acc333aa68e",
    name="Validate Plot Fit Refusal and Recovery",
    tc_id="TC-38",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"program_fits_plot_check": "false", "nonfitting_plan_drawn_check": "false", "app_refusal_check": "false", "fit_shortfall_message_check": "false"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='afb6011f-dacb-4339-a99f-7a8475bdfc66'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('whether the program fits the plot is present (in the plan findings and plot display)', instruction_id='14161926-a600-4a3c-9cb6-b2f0245a0ce7'):
        set_var('program_fits_plot_check', await testmu.vision_query(page, "whether the program fits the plot is present (in the plan findings and plot display)", ""))
    if await testmu.evaluate_branch(sub_checks=[{'description': 'the program cannot fit the plot', 'store_key': 'program_fits_plot_check', 'expected_value': 'false', 'stored_value': '{{program_fits_plot_check}}', 'operator': 'equals', 'transforms': []}], composite_operator="and"):
        async with testmu.step('whether a plan that does not fit is present (in the visible floor-plan canvas)', instruction_id='94bc457b-f01e-4d09-bfdc-ab37d9df9801'):
            set_var('nonfitting_plan_drawn_check', await testmu.vision_query(page, "whether a plan that does not fit is present (in the visible floor-plan canvas)", ""))
        
        async with testmu.step('whether the app refusal is present (in the visible page status and findings panel)', instruction_id='fd4409c3-7b68-4fc7-b85a-4fb6e51ab482'):
            set_var('app_refusal_check', await testmu.vision_query(page, "whether the app refusal is present (in the visible page status and findings panel)", ""))
        
        async with testmu.step('whether a message saying by how much it does not fit is present (in the visible page status and findings panel)', instruction_id='2c822833-7491-498a-8f9c-0f44f71184a8'):
            set_var('fit_shortfall_message_check', await testmu.vision_query(page, "whether a message saying by how much it does not fit is present (in the visible page status and findings panel)", ""))
        
        async with testmu.step('Assertion check', instruction_id='812d6baf-71ed-4955-acf4-6956568c11fd'):
            await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the app refuses', 'passed': False, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{app_refusal_check}}', 'store_key': 'app_refusal_check', 'variable_refs': {'{{app_refusal_check}}': 'false'}}, {'description': 'the app says by how much it does not fit', 'passed': False, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{fit_shortfall_message_check}}', 'store_key': 'fit_shortfall_message_check', 'variable_refs': {'{{fit_shortfall_message_check}}': 'false'}}, {'description': 'the app does not draw a plan that does not fit', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{nonfitting_plan_drawn_check}}', 'store_key': 'nonfitting_plan_drawn_check', 'variable_refs': {'{{nonfitting_plan_drawn_check}}': 'false'}}], 'sub_checks': [{'description': 'the app refuses', 'store_key': 'app_refusal_check', 'expected_value': 'true', 'extracted_value': '{{app_refusal_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the app says by how much it does not fit', 'store_key': 'fit_shortfall_message_check', 'expected_value': 'true', 'extracted_value': '{{fit_shortfall_message_check}}', 'operator': 'equals', 'transforms': []}, {'description': 'the app does not draw a plan that does not fit', 'store_key': 'nonfitting_plan_drawn_check', 'expected_value': 'false', 'extracted_value': '{{nonfitting_plan_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the app must refuse and say by how much it does not fit, and must not draw a plan that does not fit'})


if __name__ == "__main__":
    testmu.run(test)