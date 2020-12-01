# -*- coding: utf-8 -*-
##############################################################################
#
# Part of Caret IT Solutions Pvt. Ltd. (Website: www.caretit.com).
# See LICENSE file for full copyright and licensing details.
#
##############################################################################

from odoo import models, fields


class PosPaymentMethod(models.Model):
    _inherit = 'pos.payment.method'

    is_assurance = fields.Boolean('Assurance Card?')
    is_rssb_card = fields.Boolean('RSSB Card?')
    assurance_company_id = fields.Many2one('assurance.company', 'Used for Assurance Company')
