from sqlalchemy import Column, Integer, String, Float, JSON, DateTime, ForeignKey, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum

from .db.session import Base

class ProcessingStatus(str, enum.Enum):
    PENDING = "PENDING"
    CLASSIFIED = "CLASSIFIED"
    ERROR = "ERROR"

class InvoicingStatus(str, enum.Enum):
    PENDING = "PENDING"
    INVOICED = "INVOICED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"

class WorkOrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    CREATED = "CREATED"
    FAILED = "FAILED"

class ExceptionStatus(str, enum.Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"

class ActivityType(str, enum.Enum):
    SUCCESS = "SUCCESS"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"

class ShopifyOrderRaw(Base):
    __tablename__ = "shopify_order_raw"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    shopify_order_id = Column(String, index=True, unique=True)
    raw_payload = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class StgShopifySalesOrderHdr(Base):
    __tablename__ = "stg_shopify_sales_order_hdr"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    shopify_order_id = Column(String, index=True, unique=True)
    customer_email = Column(String)
    total_price = Column(Float)
    financial_status = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lines = relationship("StgShopifySalesOrderLine", back_populates="header")

class StgShopifySalesOrderLine(Base):
    __tablename__ = "stg_shopify_sales_order_line"
    id = Column(Integer, primary_key=True, index=True)
    hdr_id = Column(Integer, ForeignKey("stg_shopify_sales_order_hdr.id"))
    sku = Column(String, index=True)
    quantity = Column(Integer)
    processing_status = Column(Enum(ProcessingStatus), default=ProcessingStatus.PENDING)
    invoicing_status = Column(Enum(InvoicingStatus), default=InvoicingStatus.PENDING)
    fulfilled_qty = Column(Integer, default=0)
    unfulfilled_qty = Column(Integer, default=0)
    
    header = relationship("StgShopifySalesOrderHdr", back_populates="lines")

class MapShopifySkuErpItem(Base):
    __tablename__ = "map_shopify_sku_erp_item"
    id = Column(Integer, primary_key=True, index=True)
    shopify_sku = Column(String, index=True, unique=True)
    erp_item_code = Column(String, index=True)

class BomRecipeMaster(Base):
    __tablename__ = "bom_recipe_master"
    id = Column(Integer, primary_key=True, index=True)
    fg_item_code = Column(String, index=True)
    raw_material_code = Column(String)
    qty = Column(Float)
    uom = Column(String)

class StgWorkOrderPlan(Base):
    __tablename__ = "stg_work_order_plan"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    planning_date = Column(DateTime)
    erp_fg_item_code = Column(String, index=True)
    net_qty = Column(Float)
    status = Column(Enum(WorkOrderStatus), default=WorkOrderStatus.PENDING)
    erp_work_order_id = Column(String, nullable=True)

class StgSalesInvoice(Base):
    __tablename__ = "stg_sales_invoice"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    hdr_id = Column(Integer, ForeignKey("stg_shopify_sales_order_hdr.id"))
    erp_invoice_id = Column(String, nullable=True)
    status = Column(Enum(InvoicingStatus), default=InvoicingStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ExceptionQueue(Base):
    __tablename__ = "exception_queue"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    error_type = Column(String)
    related_sku = Column(String, nullable=True)
    description = Column(String)
    resolution_notes = Column(String, nullable=True)
    status = Column(Enum(ExceptionStatus), default=ExceptionStatus.OPEN)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ActivityLog(Base):
    __tablename__ = "activity_log"
    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, index=True)
    agent_name = Column(String)
    title = Column(String)
    description = Column(String)
    type = Column(Enum(ActivityType), default=ActivityType.INFO)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
