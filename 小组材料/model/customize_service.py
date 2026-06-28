import json
from model_service.model_service import SingleNodeService
import logging
from detector import AutoencoderDetector 

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info("=== Loading customize_service.py ===")

# ---------- 必须的 ModelService 子类（框架要求） ----------
class My_ModelService(SingleNodeService):
    """
    继承自 model_service.model_service.SingleNodeService，
    框架会自动实例化该类并调用 _inference 方法。
    """
    def __init__(self, model_name, model_path):
        super().__init__(model_name, model_path)
        # model_path 就是 /home/ma-user/infer/model/1
        self.detector = AutoencoderDetector(model_path)

    def _preprocess(self, data):
        """
        解析请求数据，框架在调用 _inference 之前会自动执行此方法。
        data 是请求体，可能为 bytes 或 dict。
        返回 (records, fields) 供 _inference 使用。
        """
        if isinstance(data, bytes):
            data = data.decode('utf-8')
        if isinstance(data, str):
            data = json.loads(data)
        records = data.get('records')
        if records is None:
            raise ValueError("Missing 'records' in request body.")
        fields = data.get('fields', None)
        return records, fields

    def _inference(self, data):
        """
        框架要求必须实现 _inference，接收预处理后的 data（此处 data 即 _preprocess 返回的元组）。
        我们设计为直接接收 (records, fields) 元组，所以 _preprocess 返回的就是这个。
        """
        records, fields = data
        return self.detector.predict(records, fields)

    def _postprocess(self, inference_result):
        """
        框架在 _inference 之后调用，可以在此封装返回格式。
        inference_result 是 _inference 的返回值（字典），我们直接序列化为 JSON 字符串。
        """
        return json.dumps(inference_result, ensure_ascii=False)