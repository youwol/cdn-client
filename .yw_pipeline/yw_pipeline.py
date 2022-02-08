from youwol.environment.forward_declaration import YouwolEnvironment
from youwol.environment.models import IPipelineFactory
from youwol.environment.models_project import JsBundle, Artifact, FileListing, Link
from youwol.pipelines.pipeline_typescript_weback_npm import pipeline, PipelineConfig, TestStepConfig, test_result, \
    test_coverage
from youwol_utils.context import Context

test_html_outputs: Artifact = Artifact(
    id='test-html-outputs',
    files=FileListing(
        include=["src/tests/html-outputs"],
    ),
    links=[
        Link(
            name='HTML outputs',
            url='src/tests/html-outputs/index.html'
        )
    ]
)


class PipelineFactory(IPipelineFactory):

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    async def get(self, env: YouwolEnvironment, context: Context):
        config = PipelineConfig(
            target=JsBundle(),
            testConfig=TestStepConfig(
                artifacts=[test_result, test_coverage, test_html_outputs]
            )
        )
        return await pipeline(config, context)