# -*- coding: utf-8 -*-
##############################################################################
#
# Part of Caret IT Solutions Pvt. Ltd. (Website: www.caretit.com).
# See LICENSE file for full copyright and licensing details.
#
##############################################################################

from odoo import fields, models

class AssuranceCompany(models.Model):
    _name = 'assurance.company'
    _description = 'Assurance Company'

    name = fields.Char('Company Name')
    pricelist_id = fields.Many2one('product.pricelist', string='PriceList')
