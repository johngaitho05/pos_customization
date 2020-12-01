# -*- coding: utf-8 -*-
##############################################################################
#
# Part of Caret IT Solutions Pvt. Ltd. (Website: www.caretit.com).
# See LICENSE file for full copyright and licensing details.
#
##############################################################################

from odoo import models, fields


class PosConfig(models.Model):
    _inherit = 'pos.config'

    enable_rssb_card = fields.Boolean('Enable RSSB Card')
